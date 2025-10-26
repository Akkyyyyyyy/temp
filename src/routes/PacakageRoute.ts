import express from "express";
import companyController from "../controller/company/company.controller";
import packageController from "../controller/package/package.controller";

const packageRouter = express.Router();

packageRouter.post("/add", packageController.createPackage);
packageRouter.get("/getAll", packageController.getAllPackages);
packageRouter.get("/:id", packageController.getPackageById);
packageRouter.put("/:id", packageController.updatePackage);
packageRouter.delete("/:id", packageController.deletePackage);
packageRouter.get("/member/:memberId", packageController.getPackagesByMember);

export default packageRouter;