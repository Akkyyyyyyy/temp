import express from "express";
import forgotPasswordController from "../controller/forgot-password/forgot-password.controller";
const forgotPasswordRouter = express.Router();

forgotPasswordRouter.post("/forgot-password", forgotPasswordController.forgotPassword);
forgotPasswordRouter.post("/verify-otp", forgotPasswordController.verifyOTP);
forgotPasswordRouter.post("/reset-password", forgotPasswordController.resetPassword);

export default forgotPasswordRouter;
