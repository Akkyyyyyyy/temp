import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from "typeorm";
import { Member } from "./Member";
import { ProjectAssignment } from "./ProjectAssignment";
import { Company } from "./Company";
import { CompanyMember } from "./CompanyMember";

export interface IRole {
  id: string;
  name: string;
  description?: string;
  companyId: string;
  company?: Company;
  createdAt: Date;
  updatedAt: Date;
  companyMembers: CompanyMember[];
  assignments: ProjectAssignment[];
}

@Entity()
export class Role implements IRole {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column()
  companyId: string;

  @ManyToOne(() => Company, (company) => company.roles)
  @JoinColumn({ name: "companyId" })
  company: Company;

  @OneToMany(() => CompanyMember, (companyMember) => companyMember.role)
  companyMembers: CompanyMember[];

  @OneToMany(() => ProjectAssignment, (assignment) => assignment.role)
  assignments: ProjectAssignment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}