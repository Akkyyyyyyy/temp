import { Request, Response } from "express";
import { ICompanyDetails, ILoginCompanyRequest, ILoginCompanyResponse, IRegisterCompanyRequest, IRegisterCompanyResponse } from "./types";
import { AppDataSource } from "../../config/data-source";
import { Company } from "../../entity/Company";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { transporter } from "../../utils/mailer";
import { Member } from "../../entity/Member";
import { CompanyMember } from "../../entity/CompanyMember";
import { deleteFromS3 } from "../../utils/s3upload";


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
            const memberRepo = AppDataSource.getRepository(Member);
            const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

            const existingCompany = await companyRepo.findOne({ where: { email } });
            if (existingCompany) {
                res.status(409).json({ message: "Email already in use" });
                return;
            }
            const existingMember = await memberRepo.findOne({ where: { email } });
            let adminMember: Member;
            const passwordHash = await bcrypt.hash(password, 10);
            const country = 'UK'
            const newCompany = companyRepo.create({
                name,
                email,
                country,
            });

            await companyRepo.save(newCompany);
            const adminName = name + " Admin"

            if (existingMember) {
                existingMember.passwordHash = passwordHash;
                adminMember = await memberRepo.save(existingMember);
            } else {
                adminMember = memberRepo.create({
                    email,
                    passwordHash
                });
                await memberRepo.save(adminMember);
            }

            const companyMember = companyMemberRepo.create({
                name: adminName,
                company: newCompany,
                member: adminMember,
                isAdmin: true,
                invitation: 'accepted',
                // role can be null for admin or set a default admin role if you have one
            });

            await companyMemberRepo.save(companyMember);
            return res.status(201).json({ message: "Company registered successfully", });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "An error occurred" });
        }
    };
    public createCompanyByMember = async (
        req: Request<{}, {}, { memberId: string; companyName: string }>,
        res: Response
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { memberId, companyName } = req.body;

            if (!memberId || !companyName) {
                return res.status(400).json({
                    success: false,
                    message: "memberId and companyName are required",
                });
            }

            const memberRepo = queryRunner.manager.getRepository(Member);
            const companyRepo = queryRunner.manager.getRepository(Company);
            const companyMemberRepo = queryRunner.manager.getRepository(CompanyMember);

            // 🔍 Find member
            const member = await memberRepo.findOne({
                where: { id: memberId },
            });

            if (!member) {
                await queryRunner.rollbackTransaction();
                return res.status(404).json({
                    success: false,
                    message: "Member not found",
                });
            }

            const allCompanyMemberships = await companyMemberRepo.find({
                where: { member: { id: memberId } },
                relations: ['company'],
                order: { createdAt: 'ASC' }
            });

            let companyMemberName;
            if (allCompanyMemberships.length > 0) {
                companyMemberName = allCompanyMemberships[0].name;
            } else {
                companyMemberName = `${companyName} Admin`;
            }
            // Create new company
            const newCompany = companyRepo.create({
                name: companyName,
                email: member.email,
                country: "UK",
            });

            await companyRepo.save(newCompany);

            const companyMember = companyMemberRepo.create({
                company: newCompany,
                member: member,
                name: companyMemberName,
                isAdmin: true,
                active: true,
                invitation: "accepted"
            });

            await companyMemberRepo.save(companyMember);
            await queryRunner.commitTransaction();

            return res.status(201).json({
                success: true,
                message: "Company created successfully",
                company: {
                    id: newCompany.id,
                    name: newCompany.name,
                    email: newCompany.email,
                    country: newCompany.country,
                },
                companyMember: {
                    id: companyMember.id,
                    name: companyMember.name,
                    isAdmin: companyMember.isAdmin,
                    active: companyMember.active
                }
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error creating company by member:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while creating company",
            });
        } finally {
            await queryRunner.release();
        }
    };
    public changeCompany = async (
        req: Request<{}, {}, { memberId: string; companyId: string }>,
        res: Response
    ) => {
        try {
            const { memberId, companyId } = req.body;

            if (!memberId || !companyId) {
                return res.status(400).json({
                    success: false,
                    message: "memberId and companyId are required",
                });
            }

            const memberRepo = AppDataSource.getRepository(Member);
            const companyRepo = AppDataSource.getRepository(Company);
            const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
            // 🔍 Find member with all companies and role
            const member = await memberRepo.findOne({
                where: { id: memberId },
                relations: [
                    "companyMembers",
                    "companyMembers.company",
                    "companyMembers.role"
                ],
            });

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: "Member not found",
                });
            }

            // ✅ Check if this member belongs to the given company
            const currentCompanyMember = member.companyMembers?.find(
                (cm) => cm.company.id === companyId
            );

            if (!currentCompanyMember) {
                return res.status(403).json({
                    success: false,
                    message: "Member does not belong to this company",
                });
            }

            // ✅ Get the company details
            const currentCompany = await companyRepo.findOneBy({ id: companyId });
            if (!currentCompany) {
                return res.status(404).json({
                    success: false,
                    message: "Company not found",
                });
            }
            const activeCompanyMembers = member.companyMembers.filter(
                cm => cm.invitation == 'accepted'
            );

            if (activeCompanyMembers.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: "Member is not associated with any company"
                });
            }

            const associatedCompanies = activeCompanyMembers?.map((cm) => ({
                id: cm.company.id,
                name: cm.company.name,
                email: cm.company.email,
                isAdmin: cm.isAdmin, // Include admin status for each company
                role: cm.role ? cm.role.name : null,
            })) ?? [];

            // ✅ Generate JWT like memberLogin
            const type = currentCompanyMember.isAdmin ? "admin" : "member";
            const token = jwt.sign(
                {
                    memberId: member.id,
                    companyId: currentCompany.id,
                    userType: type,
                    isAdmin: currentCompanyMember.isAdmin,
                    companyMemberId: currentCompanyMember.id, // Include company member relation ID
                },
                process.env.JWT_SECRET!,
                { expiresIn: "1d" }
            );

            // ✅ Build same response structure as memberLogin
            const userData = {
                id: member.id,
                name: currentCompanyMember.name,
                email: member.email,
                role: currentCompanyMember.role ? currentCompanyMember.role.name : null,
                isAdmin: currentCompanyMember.isAdmin,
                userType: type,
                location: currentCompanyMember.location ?? null,
                company: {
                    id: currentCompany.id,
                    logo: currentCompany.logo,
                    name: currentCompany.name,
                    email: currentCompany.email,
                    country: currentCompany.country,
                },
                associatedCompanies,
            };

            return res.status(200).json({
                success: true,
                message: "Company changed successfully",
                token,
                user: userData,
            });
        } catch (error) {
            console.error("Error changing company:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while changing company",
            });
        }
    };

    public getMemberCompanies = async (req: Request, res: Response) => {
        try {
            const { memberId } = req.body;

            if (!memberId) {
                return res.status(400).json({
                    success: false,
                    message: "Member ID is required"
                });
            }

            const memberRepo = AppDataSource.getRepository(Member);

            // Get member with company relationships
            const member = await memberRepo.findOne({
                where: { id: memberId },
                relations: ['companyMembers', 'companyMembers.company', 'companyMembers.role'],
            });

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: "Member not found"
                });
            }

            if (!member.companyMembers || member.companyMembers.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: "No companies found for this member",
                    companies: []
                });
            }

            // Transform company members to company data
            let companies = member.companyMembers.map((cm) => ({
                id: cm.company.id,
                name: cm.company.name,
                email: cm.company.email,
                country: cm.company.country,
                isEmailMatch: cm.company.email.toLowerCase() === member.email.toLowerCase()
            }));

            companies.sort((a, b) => {
                if (a.isEmailMatch && !b.isEmailMatch) return -1;
                if (!a.isEmailMatch && b.isEmailMatch) return 1;

                return a.name.localeCompare(b.name);
            });

            return res.status(200).json({
                success: true,
                message: "Companies retrieved successfully",
                companies: companies
            });

        } catch (error) {
            console.error("Error fetching member companies:", error);
            return res.status(500).json({
                success: false,
                message: "Server error"
            });
        }
    };
    public uploadLogo = async (req: Request, res: Response) => {
        try {
            const { companyId } = req.body;
            const file = (req as any).file;
            // Validation
            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    message: "Company ID is required"
                });
            }

            if (!file) {
                return res.status(400).json({
                    success: false,
                    message: "No file uploaded"
                });
            }

            // Validate file type
            const allowedMimeTypes = ['image/jpg', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (!allowedMimeTypes.includes(file.mimetype)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid file type. Only JPG, JPEG, PNG, GIF, and WebP images are allowed"
                });
            }

            // Validate file size (e.g., 5MB max)
            const maxSize = 5 * 1024 * 1024;
            if (file.size > maxSize) {
                return res.status(400).json({
                    success: false,
                    message: "File size too large. Maximum size is 5MB"
                });
            }

            const companyRepo = AppDataSource.getRepository(Company);

            // Find the company member relationship
            const company = await companyRepo.findOne({
                where: {
                    id: companyId
                }
            });

            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: "Member not found in this company"
                });
            }

            // Delete old profile photo if exists
            if (company.logo) {
                await this.deleteLogoFromS3(company.logo);
            }

            if (!file.s3Key) {
                console.error('No s3Key found in file object');
                return res.status(500).json({
                    success: false,
                    message: "Failed to upload profile photo - no s3Key"
                });
            }

            // Update company member profile photo
            company.logo = file.s3Key;
            company.updatedAt = new Date();

            await companyRepo.save(company);

            return res.status(200).json({
                success: true,
                message: "Logo uploaded successfully",
                profilePhotoPath: file.s3Key,
                company: {
                    id: company.id,
                    logo: file.s3Key
                }
            });

        } catch (error) {
            console.error("Error uploading profile photo:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while uploading profile photo"
            });
        }
    };
    private async deleteLogoFromS3(profilePhotoKey: string): Promise<void> {
        const bucketName = process.env.AWS_S3_BUCKET_NAME;

        if (!bucketName) {
            console.error("AWS_S3_BUCKET_NAME environment variable is not set");
            return;
        }

        if (!profilePhotoKey) {
            console.warn("No profile photo key provided for deletion");
            return;
        }

        try {
            const deleteResult = await deleteFromS3(bucketName, profilePhotoKey);

            if (!deleteResult.success) {
                console.error("Failed to delete file from S3:", deleteResult.error);
                // Don't throw error here - we still want to update the database
            }
        } catch (s3Error) {
            console.error("Error deleting file from S3:", s3Error);
            // Don't throw error here - we still want to update the database
        }
    }
    public lockDate = async (req: Request, res: Response) => {
        try {
            const { companyId, date } = req.body;

            if (!companyId || !date) {
                return res.status(400).json({
                    success: false,
                    message: "Company ID and date are required"
                });
            }

            // Validate date format (YYYY-MM-DD)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(date)) {
                return res.status(400).json({
                    success: false,
                    message: "Date must be in YYYY-MM-DD format"
                });
            }

            // Check if date is valid
            const parsedDate = new Date(date);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid date provided"
                });
            }

            const companyRepository = AppDataSource.getRepository(Company);
            const company = await companyRepository.findOneBy({ id: companyId });

            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: "Company not found"
                });
            }

            // Initialize lockedDates array if it doesn't exist
            if (!company.lockedDates) {
                company.lockedDates = [];
            }

            // Check if date is already locked
            if (company.lockedDates.includes(date)) {
                return res.status(400).json({
                    success: false,
                    message: "Date is already locked",
                    date: date,
                    lockedDates: company.lockedDates
                });
            }

            // Add date to lockedDates
            company.lockedDates.push(date);

            // Sort dates chronologically
            company.lockedDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

            await companyRepository.save(company);

            return res.status(200).json({
                success: true,
                message: "Date locked successfully",
                date: date,
                lockedDates: company.lockedDates,
                company: {
                    id: company.id,
                    name: company.name
                }
            });

        } catch (err) {
            console.error("Error locking date:", err);
            return res.status(500).json({
                success: false,
                message: "Server error while locking date"
            });
        }
    };
    public unlockDate = async (req: Request, res: Response) => {
        try {
            const { companyId, date } = req.body;

            if (!companyId || !date) {
                return res.status(400).json({
                    success: false,
                    message: "Company ID and date are required"
                });
            }

            const companyRepository = AppDataSource.getRepository(Company);
            const company = await companyRepository.findOneBy({ id: companyId });

            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: "Company not found"
                });
            }

            // Initialize lockedDates array if it doesn't exist
            if (!company.lockedDates || company.lockedDates.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "No locked dates found for this company",
                    date: date,
                    lockedDates: []
                });
            }

            // Check if date is locked
            const dateIndex = company.lockedDates.indexOf(date);
            if (dateIndex === -1) {
                return res.status(400).json({
                    success: false,
                    message: "Date is not locked",
                    date: date,
                    lockedDates: company.lockedDates
                });
            }

            // Remove date from lockedDates
            company.lockedDates.splice(dateIndex, 1);

            // Sort dates chronologically (after removal)
            company.lockedDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

            await companyRepository.save(company);

            return res.status(200).json({
                success: true,
                message: "Date unlocked successfully",
                date: date,
                lockedDates: company.lockedDates,
                company: {
                    id: company.id,
                    name: company.name
                }
            });

        } catch (err) {
            console.error("Error unlocking date:", err);
            return res.status(500).json({
                success: false,
                message: "Server error while unlocking date"
            });
        }
    };

}

export default new CompanyController();
