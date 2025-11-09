import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from "typeorm";
import { Member } from "./Member";
import { Project } from "./Project";
import { Role } from "./Role";

@Entity()
export class ProjectAssignment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Project, (project) => project.assignments, { onDelete: "CASCADE" })
  @JoinColumn()
  project: Project;

  @ManyToOne(() => Member, (member) => member.assignments, { onDelete: "CASCADE" })
  @JoinColumn()
  member: Member;

  @ManyToOne(() => Role, (role) => role.assignments, { onDelete: "RESTRICT" })
  @JoinColumn()
  role: Role;

  @Column({ type: "text", nullable: true })
  instructions: string;

  @Column({ nullable: true })
  googleEventId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}