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
  cc?: string;
}

export interface IDocument {
  title: string;
  filename: string;
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
  client?: IClient | null;
  documents?: IDocument[];
  company: Company;
  createdAt: Date;
  updatedAt: Date;
}

// Use a more flexible content type that can handle any structure
export type ContentType = string | string[] | any[];

export interface IProjectSection {
  id: string;
  type: 'text' | 'list' | 'nested' | 'item' | 'checklist';
  title: string;
  content: ContentType;
  order: number;
}

export interface IChecklistItem {
  id?: string;
  title: string;
  completed: boolean;
  description?: string;
}
export interface IReminders {
  weekBefore: boolean;
  dayBefore: boolean;
}

export interface IFolderMetadata {
  name: string;
  parentId?: string | null; // for future nested folder support
  createdAt: string;
}

export interface IMoodBoard {
  folders: {
    [folderId: string]: IFolderMetadata;
  };
  uploads: {
    [folderId: string]: string[]; // array of image URLs
  };
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
  documents: IDocument[];

  @Column({ type: "json", nullable: true })
  brief?: IProjectSection[];

  @Column({ type: "json", nullable: true })
  logistics?: IProjectSection[];

  @Column({ type: "json", nullable: true })
  checklist?: IChecklistItem[];

  @Column({ type: "json", nullable: true })
  equipments: IProjectSection[];

  @Column({
    type: "jsonb",
    nullable: false,
    default: () => `'{"weekBefore": true, "dayBefore": true}'::jsonb`,
  })
  reminders: IReminders;

  @Column({ type: "json", nullable: true, default: () => `'{"folders": {}, "uploads": {}}'` })
  moodBoard: IMoodBoard;

  @ManyToOne(() => Company, (company) => company.projects, { onDelete: "CASCADE" })
  company: Company;

  @OneToMany(() => ProjectAssignment, (assignment) => assignment.project)
  assignments: ProjectAssignment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}