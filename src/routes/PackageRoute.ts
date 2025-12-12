import express from "express";
import companyController from "../controller/company/company.controller";
import packageController from "../controller/package/package.controller";

const packageRouter = express.Router();

packageRouter.post("/add", packageController.createPackage);
packageRouter.get("/getAll", packageController.getAllPackages);
packageRouter.get("/:id", packageController.getPackageById);
packageRouter.put("/:id", packageController.updatePackage);
packageRouter.delete("/:id", packageController.deletePackage);
packageRouter.get("/company/:companyId", packageController.getPackagesByCompany);
packageRouter.post("/company/:companyId/price", packageController.setCompanyPrice);
packageRouter.put("/company/:companyId/price", packageController.updateCompanyPrice);
packageRouter.delete("/company/:companyId/price", packageController.removeCompanyPrice);

export default packageRouter;