import { Request, Response } from "express";
import { ICompanyDetails, ILoginCompanyRequest, ILoginCompanyResponse, IRegisterCompanyRequest, IRegisterCompanyResponse } from "./types";
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
            const country = 'UK'
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
}

export default new CompanyController();
