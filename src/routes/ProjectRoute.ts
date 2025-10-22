import express from "express";
import ProjectController from "../controller/project/project.controller";
import authMiddleware from "../middleware/jwt";

const projectRouter = express.Router();

projectRouter.post("/add",authMiddleware, ProjectController.createProject);
projectRouter.put("/edit", ProjectController.editProject);
projectRouter.delete("/delete", ProjectController.deleteProject);
projectRouter.post("/check-name",authMiddleware, ProjectController.checkProjectName);
projectRouter.post("/add-member",authMiddleware, ProjectController.addMemberToProject);
projectRouter.post("/remove-member",authMiddleware, ProjectController.removeMemberFromProject);
projectRouter.put("/sections", ProjectController.updateProjectSection);
projectRouter.get("/:projectId/sections", ProjectController.getProjectSections);


export default projectRouter;