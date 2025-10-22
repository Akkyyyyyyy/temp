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
import { Member, MemberRole } from "./Member";
import { Project } from "./Project";

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

  @Column({
    type: "enum",
    enum: ["Project Manager", "Creative Director", "Lead Photographer", "Photographer", "Videographer", "Editor", "Assistant", "Other"],
  })
  role: MemberRole;

  @Column({ nullable: true })
  googleEventId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}