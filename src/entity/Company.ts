import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { Member } from "./Member";
import { Project } from "./Project";

export interface ICompany {
  id: string;
  name: string;
  email: string;
  country: string;
  members?: Member[];
  projects?: Project[];
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

@Entity({ name: "Company" })
export class Company implements ICompany {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  country: string;

  @Column()
  passwordHash: string;

  @OneToMany(() => Member, (member) => member.company)
  members: Member[];

  @OneToMany(() => Project, (project) => project.company)
  projects: Project[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
