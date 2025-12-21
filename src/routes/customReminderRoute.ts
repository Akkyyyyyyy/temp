// routes/customReminder.routes.ts
import express from "express";
import authMiddleware from "../middleware/jwt";
import customReminderController from "../controller/customReminder/customReminder.controller";

const customReminderRouter = express.Router();

// Create custom reminder
customReminderRouter.post("/", authMiddleware, customReminderController.createCustomReminder);

// Get all custom reminders for an event
customReminderRouter.get("/event/:eventId", authMiddleware, customReminderController.getEventCustomReminders);

// Get all custom reminders
customReminderRouter.get("/", authMiddleware, customReminderController.getAllCustomReminders);

// Update custom reminder
customReminderRouter.patch("/:id", authMiddleware, customReminderController.updateCustomReminder);

// Delete custom reminder
customReminderRouter.delete("/:id", authMiddleware, customReminderController.deleteCustomReminder);

// Toggle reminder sent status
customReminderRouter.patch("/:id/toggle-sent", authMiddleware, customReminderController.toggleReminderSentStatus);

// Get pending reminders (for debugging/cron monitoring)
customReminderRouter.get("/pending", authMiddleware, customReminderController.getPendingCustomReminders);

export default customReminderRouter;