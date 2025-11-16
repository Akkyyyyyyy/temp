import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  ManyToMany,
  JoinTable,
} from "typeorm";
import { Company } from "./Company";
import { ProjectAssignment } from "./ProjectAssignment";
import { GoogleToken } from "./GoogleToken";
import { Package } from "./Package";
import { Role } from "./Role";
import { CompanyMember } from "./CompanyMember";

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
  // role?: Role | null;
  // isAdmin: boolean;
  assignments?: ProjectAssignment[];
  countryCode: string;
  createdAt: Date;
  updatedAt: Date;
  ringColor?: string | null;
  companyMembers?: CompanyMember[];
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
  countryCode: string;

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

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => CompanyMember, (companyMember) => companyMember.member)
  companyMembers: CompanyMember[];

  @OneToMany(() => ProjectAssignment, (assignment) => assignment.member)
  assignments: ProjectAssignment[];

  @OneToMany(() => GoogleToken, (googleToken) => googleToken.member)
  googleTokens: GoogleToken[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}