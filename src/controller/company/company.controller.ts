import { Request, Response } from "express";
import { ICompanyDetails, ILoginCompanyRequest, ILoginCompanyResponse, IRegisterCompanyRequest, IRegisterCompanyResponse } from "./types";
import { AppDataSource } from "../../config/data-source";
import { Company } from "../../entity/Company";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { transporter } from "../../utils/mailer";
import { Member } from "../../entity/Member";


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
            const existing = await memberRepo.findOne({ where: { email } });
            if (existing) {
                res.status(409).json({ message: "Email already in use" });
                return;
            }
            const passwordHash = await bcrypt.hash(password, 10);
            const country = 'UK'
            const newCompany = companyRepo.create({
                name,
                email,
                country,
            });

            await companyRepo.save(newCompany);
            const adminName = name + " Admin"

            const adminMember = memberRepo.create({
                name: adminName,
                email,
                passwordHash,
                company: newCompany,
                isAdmin: true,
                isMemberPassword: true,
            });
            await memberRepo.save(adminMember);
            return res.status(201).json({ message: "Company registered successfully", });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: "An error occurred" });
        }
    };
}

export default new CompanyController();
