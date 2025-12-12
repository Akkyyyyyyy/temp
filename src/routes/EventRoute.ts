import express from "express";
import authMiddleware from "../middleware/jwt";
import eventController from "../controller/event/event.controller";

const eventRouter = express.Router();

eventRouter.post('/add', authMiddleware, eventController.createEvent);
eventRouter.put('/update/:id', authMiddleware, eventController.editEvent);
eventRouter.delete('/delete', authMiddleware, eventController.deleteEvent);

export default eventRouter;