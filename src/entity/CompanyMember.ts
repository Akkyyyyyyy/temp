import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  Unique,
} from "typeorm";
import { Company } from "./Company";
import { Member } from "./Member";
import { Role } from "./Role";

export interface ICompanyMember {
  id: string;
  company: Company;
  member: Member;
  name: string;
  phone?: string | null;
  profilePhoto?: string | null;
  location?: string | null;
  bio?: string | null;
  skills?: string[];
  ringColor?: string | null;
  role?: Role | null;
  isAdmin: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Entity()
@Unique(["company", "member"])
export class CompanyMember implements ICompanyMember {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Company, (company) => company.companyMembers, { onDelete: "CASCADE" })
  @JoinColumn()
  company: Company;

  @ManyToOne(() => Member, (member) => member.companyMembers, { onDelete: "CASCADE" })
  @JoinColumn()
  member: Member;

  @Column()
  name: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  profilePhoto: string;

  @Column({ nullable: true })
  location: string;

  @Column({ type: "text", nullable: true })
  bio: string;

  @Column("simple-array", { default: "" })
  skills: string[];

  @Column({ nullable: true })
  ringColor: string;

  // Company-specific permissions
  @ManyToOne(() => Role, (role) => role.companyMembers, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn()
  role?: Role | null;

  @Column({ default: false })
  isAdmin: boolean;
  
  @Column({ default: true })
  active: boolean;

  @Column({
    type: "enum",
    enum: ["not_sent", "sent" ,"accepted", "rejected"],
    default: "not_sent",
  })
  invitation: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}