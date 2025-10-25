import express from "express";
import companyController from "../controller/company/company.controller";

const companyRouter = express.Router();

companyRouter.post("/register", companyController.registerCompany);
companyRouter.post("/login", companyController.loginCompany);

export default companyRouter;