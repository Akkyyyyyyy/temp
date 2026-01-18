import express from "express";
import ProjectController from "../controller/project/project.controller";
import authMiddleware from "../middleware/jwt";
import additionalTabsController from "../controller/project/additionalTabs.Controller";
import moodBoardController from "../controller/project/moodBoard.controller";
import { upload, imageUpload } from "../utils/s3upload";

const projectRouter = express.Router();

projectRouter.post("/add", authMiddleware, ProjectController.createProject);
projectRouter.put("/edit", authMiddleware, ProjectController.editProject);
projectRouter.delete("/delete", authMiddleware, ProjectController.deleteProject);
projectRouter.post("/check-name", authMiddleware, ProjectController.checkProjectName);
projectRouter.post("/add-member", authMiddleware, ProjectController.addMemberToProject);
projectRouter.post("/remove-member", authMiddleware, ProjectController.removeMemberFromProject);
projectRouter.put("/sections", authMiddleware, ProjectController.updateProjectSection);
projectRouter.get("/:projectId", authMiddleware, ProjectController.getProjectById);
projectRouter.get("/:projectId/sections", authMiddleware, ProjectController.getProjectSections);
projectRouter.get("/:projectId/checklist", authMiddleware, additionalTabsController.getProjectChecklist);
projectRouter.put("/:projectId/checklist", authMiddleware, additionalTabsController.updateProjectChecklist);
projectRouter.get("/:projectId/assignments", authMiddleware, additionalTabsController.getProjectAssignments);
projectRouter.put("/assignment/:assignmentId/instructions", authMiddleware, additionalTabsController.updateAssignmentInstructions);
projectRouter.get("/:projectId/equipments", authMiddleware, additionalTabsController.getProjectEquipments);
projectRouter.put("/:projectId/equipments", authMiddleware, additionalTabsController.updateProjectEquipments);
projectRouter.get("/:projectId/documents", authMiddleware, additionalTabsController.getProjectDocuments);
projectRouter.put("/:projectId/documents", authMiddleware, additionalTabsController.updateProjectDocuments);
projectRouter.post("/:projectId/documents/upload", upload.single("file"), additionalTabsController.uploadProjectDocument);
projectRouter.delete("/:projectId/documents/:filename", additionalTabsController.deleteProjectDocument);
projectRouter.delete("/:projectId/documents", authMiddleware, additionalTabsController.deleteProjectDocuments);
projectRouter.get('/event/:eventId/reminders', authMiddleware, additionalTabsController.getEventReminders);
projectRouter.put('/event/:eventId/reminders', authMiddleware, additionalTabsController.updateEventReminders);

// MoodBoard routes
projectRouter.get('/:projectId/moodboard',  moodBoardController.getMoodBoard);
projectRouter.post('/:projectId/moodboard/folder', moodBoardController.createFolder);
projectRouter.post('/:projectId/moodboard/upload', imageUpload.array('images', 100), moodBoardController.uploadImages);
projectRouter.delete('/:projectId/moodboard/image', moodBoardController.deleteImage);
projectRouter.delete('/:projectId/moodboard/folder', moodBoardController.deleteFolder);

export default projectRouter;