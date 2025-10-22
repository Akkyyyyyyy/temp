import "reflect-metadata"
import { DataSource } from "typeorm"
import * as dotenv from "dotenv";
import { Company } from "../entity/Company";
import { Member } from "../entity/Member";
import { Project } from "../entity/Project";
import { ProjectAssignment } from "../entity/ProjectAssignment";
import { GoogleToken } from "../entity/GoogleToken";


export const AppDataSource = new DataSource({
    type: "postgres",
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "5432"),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    synchronize: true,
    logging: false,
    entities: [Company, Member, Project, ProjectAssignment, GoogleToken],
    migrations: [],
    subscribers: [],
    // ssl: {
    //     rejectUnauthorized: false, // required for AWS RDS if you don’t provide a cert
    // },
})
