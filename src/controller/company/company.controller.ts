import { Request, Response } from "express";
import { ICompanyDetails, ILoginCompanyRequest, ILoginCompanyResponse, IRegisterCompanyRequest, IRegisterCompanyResponse } from "./types";
import { AppDataSource } from "../../config/data-source";
import { Company } from "../../entity/Company";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { transporter } from "../../utils/mailer";
import { Member } from "../../entity/Member";
import { CompanyMember } from "../../entity/CompanyMember";


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
                    name: adminName,
                    email,
                    passwordHash
                });
                await memberRepo.save(adminMember);
            }
            
            const companyMember = companyMemberRepo.create({
                company: newCompany,
                member: adminMember,
                isAdmin: true,
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
        try {
            const { memberId, companyName } = req.body;

            if (!memberId || !companyName) {
                return res.status(400).json({
                    success: false,
                    message: "memberId and companyName are required",
                });
            }

            const memberRepo = AppDataSource.getRepository(Member);
            const companyRepo = AppDataSource.getRepository(Company);
            const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

            // 🔍 Find member
            const member = await memberRepo.findOne({
                where: { id: memberId },
            });

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: "Member not found",
                });
            }

            // ✨ Create new company
            const newCompany = companyRepo.create({
                name: companyName,
                email: member.email,
                country: "UK",
            });

            await companyRepo.save(newCompany);

            const companyMember = companyMemberRepo.create({
                company: newCompany,
                member: member,
                isAdmin: true, // Member becomes admin of their own company
                active: true, //
                // role can be set to null or create a default admin role
            });

            await companyMemberRepo.save(companyMember);
            return res.status(201).json({
                success: true,
                message: "Company created successfully",
                company: {
                    id: newCompany.id,
                    name: newCompany.name,
                    email: newCompany.email,
                    country: newCompany.country,
                },
            });
        } catch (error) {
            console.error("Error creating company by member:", error);
            return res.status(500).json({
                success: false,
                message: "Server error while creating company",
            });
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
            const associatedCompanies = member.companyMembers?.map((cm) => ({
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
                name: member.name,
                email: member.email,
                role: currentCompanyMember.role ? currentCompanyMember.role.name : null,
                isAdmin: currentCompanyMember.isAdmin,
                userType: type,
                location: member.location ?? null,
                company: {
                    id: currentCompany.id,
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

}

export default new CompanyController();
