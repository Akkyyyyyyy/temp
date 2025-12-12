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
import { Company } from "./Company";
import { CompanyMember } from "./CompanyMember";
import { EventAssignment } from "./EventAssignment";

export interface IRole {
  id: string;
  name: string;
  description?: string;
  companyId: string;
  company?: Company;
  createdAt: Date;
  updatedAt: Date;
  companyMembers: CompanyMember[];
  eventAssignments: EventAssignment[];
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

  @OneToMany(() => EventAssignment, (assignment) => assignment.role)
  eventAssignments: EventAssignment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}