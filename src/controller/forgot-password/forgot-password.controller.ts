import { Request, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { Company } from "../../entity/Company";
import { Member } from "../../entity/Member";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { transporter, sendEmail } from "../../utils/mailer";
import { 
    IForgotPasswordRequest, 
    IVerifyOTPRequest, 
    IResetPasswordRequest, 
    IPasswordResetToken, 
    IVerifiedResetToken 
} from "./types";

class ForgotPasswordController {
    private readonly JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    private readonly PASSWORD_RESET_EXPIRY = '15m';

    public forgotPassword = async (
        req: Request<{}, {}, IForgotPasswordRequest>,
        res: Response
    ) => {
        try {
            const { email, userType } = req.body;

            if (!email || !userType) {
                return res.status(400).json({ message: "Email and user type are required" });
            }

            if (!['company', 'member'].includes(userType)) {
                return res.status(400).json({ message: "User type must be either 'company' or 'member'" });
            }

            let user;
            if (userType === 'company') {
                const companyRepo = AppDataSource.getRepository(Company);
                user = await companyRepo.findOne({ where: { email } });
            } else {
                const memberRepo = AppDataSource.getRepository(Member);
                user = await memberRepo.findOne({ where: { email } });
            }

            if (!user) {
                return res.status(200).json({
                    success: true,
                    message: "If the email exists, a reset link has been sent"
                });
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();

            const resetToken = jwt.sign(
                {
                    email,
                    otp,
                    userType,
                    type: 'password_reset'
                },
                this.JWT_SECRET,
                { expiresIn: this.PASSWORD_RESET_EXPIRY }
            );

            try {
                if (process.env.SMTP_EMAIL) {
                    await sendEmail(
                        email,
                        'Password Reset OTP',
                        `
                            <h2>Password Reset Request</h2>
                            <p>Your OTP code is: <strong>${otp}</strong></p>
                            <p>This OTP will expire in 15 minutes.</p>
                            <p>If you didn't request this, please ignore this email.</p>
                        `
                    );
                }
            } catch (emailError) {
                console.error('Email sending failed:', emailError);
                if (process.env.NODE_ENV === 'development') {
                    console.log(`OTP for ${email}: ${otp}`);
                    console.log(`Reset token: ${resetToken}`);
                }
            }

            return res.status(200).json({
                success: true,
                message: "OTP sent to email",
                otp,
                data: { token: resetToken }
            });

        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: "An error occurred" });
        }
    };

    public verifyOTP = async (
        req: Request<{}, {}, IVerifyOTPRequest>,
        res: Response
    ) => {
        try {
            const { email, otp, token, userType } = req.body;

            if (!email || !otp || !token || !userType) {
                return res.status(400).json({ message: "Email, OTP, token, and user type are required" });
            }

            if (!['company', 'member'].includes(userType)) {
                return res.status(400).json({ message: "User type must be either 'company' or 'member'" });
            }

            try {
                const decoded = jwt.verify(token, this.JWT_SECRET) as IPasswordResetToken;

                if (decoded.type !== 'password_reset' || decoded.email !== email || decoded.userType !== userType) {
                    return res.status(400).json({ message: "Invalid token" });
                }

                if (decoded.otp !== otp) {
                    return res.status(400).json({ message: "Invalid OTP" });
                }

                const verifiedToken = jwt.sign(
                    {
                        email,
                        userType,
                        type: 'password_reset_verified',
                        verifiedAt: Date.now()
                    },
                    this.JWT_SECRET,
                    { expiresIn: '10m' }
                );

                return res.status(200).json({
                    success: true,
                    message: "OTP verified successfully",
                    data: { token: verifiedToken }
                });

            } catch (jwtError) {
                if (jwtError instanceof jwt.TokenExpiredError) {
                    return res.status(400).json({ message: "OTP has expired" });
                }
                if (jwtError instanceof jwt.JsonWebTokenError) {
                    return res.status(400).json({ message: "Invalid token" });
                }
                throw jwtError;
            }

        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: "An error occurred" });
        }
    };

    public resetPassword = async (
        req: Request<{}, {}, IResetPasswordRequest>,
        res: Response
    ) => {
        try {
            const { token, newPassword } = req.body;

            if (!token || !newPassword) {
                return res.status(400).json({ message: "Token and new password are required" });
            }

            if (newPassword.length < 6) {
                return res.status(400).json({ message: "Password must be at least 6 characters long" });
            }

            try {
                // Verify the reset token
                const decoded = jwt.verify(token, this.JWT_SECRET) as IVerifiedResetToken;

                // Validate token type
                if (decoded.type !== 'password_reset_verified') {
                    return res.status(400).json({ message: "Invalid token type" });
                }

                const { email, userType } = decoded;

                // Update password based on user type
                if (userType === 'company') {
                    const companyRepo = AppDataSource.getRepository(Company);
                    const company = await companyRepo.findOne({ where: { email } });

                    if (!company) {
                        return res.status(400).json({ message: "Company not found" });
                    }

                    // Check if new password is different from current password
                    const isSamePassword = await bcrypt.compare(newPassword, company.passwordHash);
                    if (isSamePassword) {
                        return res.status(400).json({ message: "New password must be different from current password" });
                    }

                    const passwordHash = await bcrypt.hash(newPassword, 10);
                    company.passwordHash = passwordHash;
                    company.updatedAt = new Date();
                    await companyRepo.save(company);

                } else if (userType === 'member') {
                    const memberRepo = AppDataSource.getRepository(Member);
                    const member = await memberRepo.findOne({ where: { email } });

                    if (!member) {
                        return res.status(400).json({ message: "Member not found" });
                    }

                    // Check if new password is different from current password
                    const isSamePassword = await bcrypt.compare(
                        String(newPassword),
                        String(member.passwordHash)
                    );

                    if (isSamePassword) {
                        return res.status(400).json({ message: "New password must be different from current password" });
                    }

                    const passwordHash = await bcrypt.hash(newPassword, 10);
                    member.passwordHash = passwordHash;
                    member.updatedAt = new Date();
                    member.isMemberPassword = true;
                    await memberRepo.save(member);
                } else {
                    return res.status(400).json({ message: "Invalid user type" });
                }

                return res.status(200).json({
                    success: true,
                    message: "Password reset successfully"
                });

            } catch (jwtError) {
                if (jwtError instanceof jwt.TokenExpiredError) {
                    return res.status(400).json({ message: "Reset token has expired" });
                }
                if (jwtError instanceof jwt.JsonWebTokenError) {
                    return res.status(400).json({ message: "Invalid token" });
                }
                throw jwtError;
            }

        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: "An error occurred" });
        }
    };
}

export default new ForgotPasswordController();
