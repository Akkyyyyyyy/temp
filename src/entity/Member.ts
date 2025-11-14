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
  role?: Role | null;
  isAdmin: boolean;
  company: Company[];
  assignments?: ProjectAssignment[];
  countryCode: string;
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

  @Column({ default: false })
  isMemberPassword: boolean;

  @Column({ default: true })
  active: boolean;

  @ManyToOne(() => Role, (role) => role.members, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn()
  role?: Role | null;

  @Column({ default: false })
  isAdmin: boolean;

  @ManyToMany(() => Company, (company) => company.members, { cascade: true })
  @JoinTable()
  company: Company[];

  @OneToMany(() => ProjectAssignment, (assignment) => assignment.member)
  assignments: ProjectAssignment[];

  @OneToMany(() => GoogleToken, (googleToken) => googleToken.member)
  googleTokens: GoogleToken[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}