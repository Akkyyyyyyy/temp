import express from "express";
import companyRouter from "./CompanyRoute";
import memberRouter from "./MemberRoute";
import projectRouter from "./ProjectRoute";
import googleCalendarRouter from "./google-calendarRoutes";
import forgotPasswordRouter from "./ForgotPasswordRoute";
import packageRouter from "./PackageRoute";
import roleRouter from "./RoleRoute";
import eventRouter from "./EventRoute";


const mainRouter = express.Router();

mainRouter.use("/auth", forgotPasswordRouter);
mainRouter.use("/company", companyRouter);
mainRouter.use("/member", memberRouter);
mainRouter.use("/project", projectRouter);
mainRouter.use("/calendar", googleCalendarRouter);
mainRouter.use("/package", packageRouter);
mainRouter.use("/roles", roleRouter);
mainRouter.use("/event", eventRouter);


export default mainRouter;
