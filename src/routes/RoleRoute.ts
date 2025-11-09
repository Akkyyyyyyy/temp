import express from "express";
import RoleController from "../controller/role/role.controller";
import authMiddleware from "../middleware/jwt";

const roleRouter = express.Router();

roleRouter.use(authMiddleware);
roleRouter.post("/company", RoleController.getCompanyRoles);
roleRouter.post("/:id", RoleController.getRoleById);
roleRouter.post("/:id/usage", RoleController.getRoleUsage);
roleRouter.post("/", RoleController.createRole);
roleRouter.put("/:id", RoleController.updateRole);
roleRouter.delete("/:id", RoleController.deleteRole);


export default roleRouter;