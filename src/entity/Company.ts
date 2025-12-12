import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToMany,
} from "typeorm";
import { Member } from "./Member";
import { Project } from "./Project";
import { Role } from "./Role";
import { Package } from "./Package";
import { CompanyMember } from "./CompanyMember";

export interface ICompany {
  id: string;
  name: string;
  email: string;
  country: string;
  members?: Member[];
  projects?: Project[];
  roles?: Role[];
  createdAt: Date;
  updatedAt: Date;
}

@Entity({ name: "Company" })
export class Company implements ICompany {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ nullable: true })
  logo: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  country: string;

  @Column("decimal", { scale: 2, nullable: true })
  price: number | null;

  @OneToMany(() => CompanyMember, (companyMember) => companyMember.company)
  companyMembers: CompanyMember[];

  @OneToMany(() => Project, (project) => project.company)
  projects: Project[];

  @OneToMany(() => Package, (pkg) => pkg.company)
  packages: Package[];

  @OneToMany(() => Role, (role) => role.company)
  roles: Role[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}