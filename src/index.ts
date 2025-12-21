import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import { AppDataSource } from "./config/data-source";
import mainRouter from "./routes/main";
import { cronWorker } from "./worker/cron-worker";

AppDataSource.initialize().then(async () => {
  const app = express();

  app.use(bodyParser.json());
  app.use(express.static("public"));

  app.use(cors({
    origin: process.env.VITE_FRONTEND_URL ,
    credentials: true
  }));

  app.use("/", mainRouter);

  app.use("/test", (req, res) => {
    res.send("Server is running.....!");
  });

  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
  cronWorker.start();

}).catch(error => console.log(error));
