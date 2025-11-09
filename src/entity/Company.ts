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
import { Role } from "./Role";

export interface ICompany {
  id: string;
  name: string;
  email: string;
  country: string;
  members?: Member[];
  projects?: Project[];
  roles?: Role[];
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

  @OneToMany(() => Role, (role) => role.company)
  roles: Role[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}