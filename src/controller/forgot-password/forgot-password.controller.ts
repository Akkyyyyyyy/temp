import { Request, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { Company } from "../../entity/Company";
import { Member } from "../../entity/Member";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { transporter, sendEmail, sendForgotPasswordEmail } from "../../utils/mailer";
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
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({ message: "Email and user type are required" });
            }

            const memberRepo = AppDataSource.getRepository(Member);
            const user = await memberRepo.findOne({
                where: { email },
                relations: ['companyMembers', 'companyMembers.company', 'companyMembers.role']
            });

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
                    type: 'password_reset'
                },
                this.JWT_SECRET,
                { expiresIn: this.PASSWORD_RESET_EXPIRY }
            );

            try {
                if (process.env.SMTP_EMAIL) {
                    await sendForgotPasswordEmail(
                        email,
                        otp,
                        'VIP',
                        '15 minutes'
                    );
                } else {
                    // In development, log the OTP
                    console.log(`Password Reset OTP for ${email}: ${otp}`);
                    console.log(`Reset token: ${resetToken}`);
                }
            } catch (emailError) {
                console.error('Email sending failed:', emailError);
                if (process.env.NODE_ENV === 'development') {
                    console.log(`OTP for ${email}: ${otp}`);
                    console.log(`Reset token: ${resetToken}`);
                }
                return res.status(400).json({
                    success: false,
                    message: "Error while sending OTP"
                });
            }

            return res.status(200).json({
                success: true,
                message: "OTP sent to email",
                // otp,
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
            const { email, otp, token } = req.body;

            if (!email || !otp || !token) {
                return res.status(400).json({ message: "Email, OTP, token, and user type are required" });
            }


            try {
                const decoded = jwt.verify(token, this.JWT_SECRET) as IPasswordResetToken;

                if (decoded.type !== 'password_reset' || decoded.email !== email) {
                    return res.status(400).json({ message: "Invalid token" });
                }

                if (decoded.otp !== otp) {
                    return res.status(400).json({ message: "Invalid OTP" });
                }

                const verifiedToken = jwt.sign(
                    {
                        email,
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

                const { email } = decoded;

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
                await memberRepo.save(member);


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
