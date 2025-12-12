// routes/google-calendar.routes.ts
import express from "express";
import googleCalendarController from "../controller/google-calendar/google-calendar.controller";
import authMiddleware from "../middleware/jwt";

const googleCalendarRouter = express.Router();

// Authentication routes
googleCalendarRouter.post("/auth", googleCalendarController.initiateAuth);
googleCalendarRouter.get("/callback", googleCalendarController.handleCallback);
googleCalendarRouter.post("/check-auth", googleCalendarController.checkAuth);
googleCalendarRouter.post("/disconnect", googleCalendarController.disconnect);

googleCalendarRouter.post("/sync-events", googleCalendarController.syncEventAssignments);
googleCalendarRouter.post("/sync-event/:assignmentId", authMiddleware, googleCalendarController.syncSingleEventAssignment);
googleCalendarRouter.put("/event/:eventId", authMiddleware, googleCalendarController.updateEvent);
googleCalendarRouter.delete("/event/:googleEventId", authMiddleware, googleCalendarController.deleteEvent);
googleCalendarRouter.get("/assignments", authMiddleware, googleCalendarController.getEventAssignments);

export default googleCalendarRouter;