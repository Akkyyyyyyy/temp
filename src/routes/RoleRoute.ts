import express from "express";
import RoleController from "../controller/role/role.controller";
import authMiddleware from "../middleware/jwt";

const roleRouter = express.Router();

roleRouter.post("/company",authMiddleware, RoleController.getCompanyRoles);
roleRouter.post("/:id",authMiddleware, RoleController.getRoleById);
// roleRouter.post("/:id/usage",authMiddleware, RoleController.getRoleUsage);
roleRouter.post("/",authMiddleware, RoleController.createRole);
roleRouter.put("/:id",authMiddleware, RoleController.updateRole);
// roleRouter.delete("/:id",authMiddleware, RoleController.deleteRole);


export default roleRouter;