import express from "express";
import companyController from "../controller/company/company.controller";

const companyRouter = express.Router();

companyRouter.post("/register", companyController.registerCompany);
companyRouter.post("/create-by-member", companyController.createCompanyByMember);
companyRouter.post("/change-company", companyController.changeCompany);

export default companyRouter;