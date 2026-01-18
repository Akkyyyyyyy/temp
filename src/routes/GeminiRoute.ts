import express from "express";
import GeminiController from "../controller/gemini/gemini.controller";
import authMiddleware from "../middleware/jwt";

const geminiRouter = express.Router();

geminiRouter.post("/recommend", GeminiController.recommendPackages);
geminiRouter.post("/quick-search", GeminiController.quickSearch);
geminiRouter.get("/models", GeminiController.listModels);


export default geminiRouter;