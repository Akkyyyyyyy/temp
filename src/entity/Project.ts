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
import { Company } from "./Company";
import { ProjectAssignment } from "./ProjectAssignment";

export interface IClient {
  name?: string;
  mobile?: string;
  email?: string;
}

export interface IProject {
  id: string;
  name: string;
  color: string;
  startDate: string;
  endDate: string;
  startHour: number;
  endHour: number;
  location: string;
  description?: string | null;
  client?: IClient | null;  // Add client field
  company: Company
  createdAt: Date;
  updatedAt: Date;
}
// Use a more flexible content type that can handle any structure
export type ContentType = string | string[] | any[];

export interface IProjectSection {
  id: string;
  type: 'text' | 'list' | 'nested' | 'item' | 'checklist';
  title: string;
  content: ContentType; // Use the flexible type
  order: number;
}


@Entity()
export class Project implements IProject {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column()
  color: string;

  @Column({ type: "date" })
  startDate: string;

  @Column({ type: "date" })
  endDate: string;

  @Column()
  startHour: number;

  @Column()
  endHour: number;

  @Column()
  location: string;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ type: "json", nullable: true })
  client: IClient;

  @Column({ type: "json", nullable: true })
  brief?: IProjectSection[];

  @Column({ type: "json", nullable: true })
  logistics?: IProjectSection[]; 

  @ManyToOne(() => Company, (company) => company.projects, { onDelete: "CASCADE" })
  company: Company;

  @OneToMany(() => ProjectAssignment, (assignment) => assignment.project)
  assignments: ProjectAssignment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}