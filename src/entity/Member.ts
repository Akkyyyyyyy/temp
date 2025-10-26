import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Company } from "./Company";
import { ProjectAssignment } from "./ProjectAssignment";
import { GoogleToken } from "./GoogleToken";
import { Package } from "./Package";

export type MemberRole = "Project Manager" | "Creative Director" | "Lead Photographer" | "Photographer" | "Videographer" | "Editor" | "Assistant" | "Other";

export interface IMember {
  id: string; // UUID
  name: string;
  email: string;
  phone?: string | null;
  profilePhoto?: string | null;
  color?: string | null;
  location?: string | null;
  bio?: string | null;
  skills?: string[];
  passwordHash?: string | null;
  isMemberPassword?: boolean;
  role: MemberRole;
  company: Company;
  assignments?: ProjectAssignment[];
  createdAt: Date;
  updatedAt: Date;
  ringColor?: string | null;
}

@Entity()
export class Member implements IMember {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  profilePhoto: string;

  @Column({ nullable: true })
  color: string;

  @Column({ nullable: true })
  location: string;

  @Column({ type: "text", nullable: true })
  bio: string;

  @Column("simple-array", { default: "" })
  skills: string[];

  @Column({ nullable: true })
  ringColor: string;

  @Column({ nullable: true })
  passwordHash: string;

  @Column({ default: false })
  isMemberPassword: boolean;

  @Column({ default: true })
  active: boolean;

  @Column({
    type: "enum",
    enum: ["Project Manager", "Creative Director", "Lead Photographer", "Photographer", "Videographer", "Editor", "Assistant", "Other"]
  })
  role: MemberRole;

  @ManyToOne(() => Company, (company) => company.members, { onDelete: "CASCADE" })
  company: Company;

  @OneToMany(() => ProjectAssignment, (assignment) => assignment.member)
  assignments: ProjectAssignment[];

  @OneToMany(() => GoogleToken, (googleToken) => googleToken.member)
  googleTokens: GoogleToken[];

  @OneToMany(() => Package, (pkg) => pkg.member)
  packages: Package[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}