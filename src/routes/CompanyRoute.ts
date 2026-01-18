import express from "express";
import companyController from "../controller/company/company.controller";
import { createUploadMiddleware, upload } from "../utils/s3upload";
import authMiddleware from "../middleware/jwt";

const companyRouter = express.Router();

companyRouter.post("/register", companyController.registerCompany);
companyRouter.post("/create-by-member", companyController.createCompanyByMember);
companyRouter.post("/change-company", companyController.changeCompany);
companyRouter.post("/get-companies", companyController.getMemberCompanies);
companyRouter.post("/upload-logo", authMiddleware, upload.single('photo'), createUploadMiddleware('photo', 'images'), companyController.uploadLogo);
companyRouter.post("/lock-date", companyController.lockDate);
companyRouter.post("/unlock-date", companyController.unlockDate);
companyRouter.get("/future-locked-dates/:companyId", companyController.getFutureLockedDates);


export default companyRouter;