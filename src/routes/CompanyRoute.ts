import express from "express";
import companyController from "../controller/company/company.controller";

const companyRouter = express.Router();

companyRouter.post("/register", companyController.registerCompany);
companyRouter.post("/login", companyController.loginCompany);
companyRouter.post("/forgot-password", companyController.forgotPassword);
companyRouter.post("/verify-otp", companyController.verifyOTP);
companyRouter.post("/reset-password", companyController.resetPassword);

export default companyRouter;