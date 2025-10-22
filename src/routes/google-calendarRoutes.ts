// routes/google-calendar.routes.ts
import express from "express";
import googleCalendarController from "../controller/google-calendar/google-calendar.controller";

const googleCalendarRouter = express.Router();

googleCalendarRouter.post("/auth", googleCalendarController.initiateAuth);
googleCalendarRouter.get("/callback", googleCalendarController.handleCallback);
googleCalendarRouter.post("/check-auth", googleCalendarController.checkAuth);
googleCalendarRouter.post("/sync-projects", googleCalendarController.syncProjects);
googleCalendarRouter.post("/disconnect", googleCalendarController.disconnect);
// googleCalendarRouter.post("/projects-by-member", authMiddleware, googleCalendarController.getAllProjectsByMember);
export default googleCalendarRouter;