import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Project } from "./Project";
import { EventAssignment } from "./EventAssignment";
import { CustomReminder } from "./CustomReminder";

export interface IEvents {
  id: string;
  date: string;
  startHour: number;
  endHour: number;
  location: string;
  project: Project;
  reminders:IReminders;
  assignments?: EventAssignment[];
  customReminders?: CustomReminder[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IReminders {
  weekBefore: boolean;
  dayBefore: boolean;
}

@Entity()
export class Events implements IEvents {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({ type: "date" })
  date: string;

  @Column()
  startHour: number;

  @Column()
  endHour: number;

  @Column()
  location: string;

  @Column({
    type: "jsonb",
    nullable: false,
    default: () => `'{"weekBefore": true, "dayBefore": true}'::jsonb`,
  })
  reminders: IReminders;

  @ManyToOne(() => Project, (project) => project.events, { onDelete: "CASCADE" })
  project: Project;

  @OneToMany(() => EventAssignment, (assignment) => assignment.events)
  assignments: EventAssignment[];

  @OneToMany(() => CustomReminder, (customReminder) => customReminder.event)
  customReminders: CustomReminder[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
