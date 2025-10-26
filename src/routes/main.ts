import express from "express";
import companyRouter from "./CompanyRoute";
import memberRouter from "./MemberRoute";
import projectRouter from "./ProjectRoute";
import googleCalendarRouter from "./google-calendarRoutes";
import forgotPasswordRouter from "./ForgotPasswordRoute";
import packageRouter from "./PacakageRoute";


const mainRouter = express.Router();

mainRouter.use("/auth", forgotPasswordRouter);
mainRouter.use("/company", companyRouter);
mainRouter.use("/member", memberRouter);
mainRouter.use("/project", projectRouter);
mainRouter.use("/calendar", googleCalendarRouter);
mainRouter.use("/package", packageRouter);


export default mainRouter;
