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
  role?: Role | null;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Entity()
@Unique(["company", "member"]) // Ensure a member can only have one role per company
export class CompanyMember implements ICompanyMember {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Company, (company) => company.companyMembers, { onDelete: "CASCADE" })
  @JoinColumn()
  company: Company;

  @ManyToOne(() => Member, (member) => member.companyMembers, { onDelete: "CASCADE" })
  @JoinColumn()
  member: Member;

  @ManyToOne(() => Role, (role) => role.companyMembers, { onDelete: "RESTRICT", nullable: true })
  @JoinColumn()
  role?: Role | null;

  @Column({ default: false })
  isAdmin: boolean;
  
  @Column({ default: true }) // Add this - company-specific active status
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}