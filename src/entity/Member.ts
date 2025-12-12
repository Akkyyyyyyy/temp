import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { GoogleToken } from "./GoogleToken";
import { CompanyMember } from "./CompanyMember";
import { EventAssignment } from "./EventAssignment";

export interface IMember {
  id: string;
  email: string;
  passwordHash?: string | null;
  eventAssignments?: EventAssignment[];
  googleTokens?: GoogleToken[];
  companyMembers?: CompanyMember[];
  createdAt: Date;
  updatedAt: Date;
}

@Entity()
export class Member implements IMember {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  passwordHash: string;

  @Column({ default: true })
  active: boolean;

  @OneToMany(() => CompanyMember, (companyMember) => companyMember.member)
  companyMembers: CompanyMember[];

  @OneToMany(() => EventAssignment, (assignment) => assignment.member)
  eventAssignments: EventAssignment[];

  @OneToMany(() => GoogleToken, (googleToken) => googleToken.member)
  googleTokens: GoogleToken[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}