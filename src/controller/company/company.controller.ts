import { Request, Response } from "express";
import { ICompanyDetails, IForgotPasswordRequest, ILoginCompanyRequest, ILoginCompanyResponse, IPasswordResetToken, IRegisterCompanyRequest, IRegisterCompanyResponse, IResetPasswordRequest, IVerifiedResetToken, IVerifyOTPRequest } from "./types";
import { AppDataSource } from "../../config/data-source";
import { Company } from "../../entity/Company";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { transporter } from "../../utils/mailer";


class CompanyController {
    public registerCompany = async (
        req: Request<{}, {}, IRegisterCompanyRequest>,
        res: Response<IRegisterCompanyResponse>
    ) => {

        try {
            const { name, email, password } = req.body;

            if (!name || !email || !password) {
                res.status(400).json({ message: "All fields are required" });
                return;
            }
            const companyRepo = AppDataSource.getRepository(Company);
            const existing = await companyRepo.findOne({ where: { email } });
            if (existing) {
                res.status(409).json({ message: "Email already in use" });
                return;
            }
            const passwordHash = await bcrypt.hash(password, 10);
            const country = 'US'
            const newCompany = companyRepo.create({
                name,
                email,
                country,
                passwordHash,
            });

            await companyRepo.save(newCompany);
            return res.status(201).json({ message: "Company registered successfully", });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "An error occurred" });
        }
    };
    public loginCompany = async (
        req: Request<{}, {}, ILoginCompanyRequest>,
        res: Response<ILoginCompanyResponse>
    ) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ message: "Email and password are required" });
            }

            const companyRepo = AppDataSource.getRepository(Company);
            const company = await companyRepo.findOne({ where: { email } });

            if (!company) {
                return res.status(404).json({ message: "Invalid credentials" });
            }

            const isPasswordValid = await bcrypt.compare(password, company.passwordHash);

            if (!isPasswordValid) {
                return res.status(401).json({ message: "Invalid credentials" });
            }

            const token = jwt.sign(
                { companyId: company.id, email: company.email },
                process.env.JWT_SECRET,
                { expiresIn: "1d" }
            );

            const companyDetails: ICompanyDetails = {
                id: company.id,
                name: company.name,
                email: company.email,
                country: company.country,
            };

            return res.status(200).json({
                message: "Login successful",
                token,
                companyDetails
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "An error occurred" });
        }
    };
    private readonly JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    private readonly PASSWORD_RESET_EXPIRY = '15m';

    public forgotPassword = async (
        req: Request<{}, {}, IForgotPasswordRequest>,
        res: Response
    ) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({ message: "Email is required" });
            }

            const companyRepo = AppDataSource.getRepository(Company);
            const company = await companyRepo.findOne({ where: { email } });

            if (!company) {
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

            // try {
            //     if (process.env.SMTP_EMAIL) {
            //         await transporter.sendMail({
            //             from: process.env.EMAIL_USER,
            //             to: email,
            //             subject: 'Password Reset OTP',
            //             html: `
            //             <h2>Password Reset Request</h2>
            //             <p>Your OTP code is: <strong>${otp}</strong></p>
            //             <p>This OTP will expire in 15 minutes.</p>
            //             <p>If you didn't request this, please ignore this email.</p>
            //         `
            //         });
            //     }

            // } catch (emailError) {
            //     console.error('Email sending failed:', emailError);
            //     if (process.env.NODE_ENV === 'development') {
            //         console.log(`OTP for ${email}: ${otp}`);
            //         console.log(`Reset token: ${resetToken}`);
            //     }
            // }

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
            const { email, otp, token } = req.body;

            if (!email || !otp || !token) {
                return res.status(400).json({ message: "Email, OTP, and token are required" });
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

                // Update password
                const companyRepo = AppDataSource.getRepository(Company);
                const company = await companyRepo.findOne({ where: { email: decoded.email } });

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

export default new CompanyController();
