import express from "express";
import ProjectController from "../controller/project/project.controller";
import authMiddleware from "../middleware/jwt";
import additionalTabsController from "../controller/project/additionalTabs.Controller";
import { upload } from "../utils/s3upload";

const projectRouter = express.Router();

projectRouter.post("/add", authMiddleware, ProjectController.createProject);
projectRouter.put("/edit", ProjectController.editProject);
projectRouter.delete("/delete", ProjectController.deleteProject);
projectRouter.post("/check-name", authMiddleware, ProjectController.checkProjectName);
projectRouter.post("/add-member", authMiddleware, ProjectController.addMemberToProject);
projectRouter.post("/remove-member", authMiddleware, ProjectController.removeMemberFromProject);
projectRouter.put("/sections", ProjectController.updateProjectSection);
projectRouter.get("/:projectId", ProjectController.getProjectById);
projectRouter.get("/:projectId/sections", ProjectController.getProjectSections);
projectRouter.get("/:projectId/checklist", additionalTabsController.getProjectChecklist);
projectRouter.put("/:projectId/checklist", additionalTabsController.updateProjectChecklist);
projectRouter.get("/:projectId/assignments", additionalTabsController.getProjectAssignments);
projectRouter.put("/assignment/:assignmentId/instructions", additionalTabsController.updateAssignmentInstructions);
projectRouter.get("/:projectId/equipments", additionalTabsController.getProjectEquipments);
projectRouter.put("/:projectId/equipments", additionalTabsController.updateProjectEquipments);
projectRouter.get("/:projectId/documents", additionalTabsController.getProjectDocuments);
projectRouter.put("/:projectId/documents", additionalTabsController.updateProjectDocuments);
projectRouter.post("/:projectId/documents/upload", upload.single("file"), additionalTabsController.uploadProjectDocument);
projectRouter.delete("/:projectId/documents/:filename", additionalTabsController.deleteProjectDocument);
projectRouter.delete("/:projectId/documents", additionalTabsController.deleteProjectDocuments);


export default projectRouter;