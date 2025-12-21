// entity/CustomReminder.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Events } from "./Events";

export interface ICustomReminder {
  id: string;
  event: Events;
  reminderDate: string; // Date when reminder should be sent (YYYY-MM-DD)
  reminderHour: number; // Hour when reminder should be sent (0-23)
  isSent: boolean;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Entity()
export class CustomReminder implements ICustomReminder {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Events, (event) => event.customReminders, { 
    onDelete: "CASCADE",
    nullable: false 
  })
  event: Events;

  @Column({ type: "date" })
  reminderDate: string;

  @Column()
  reminderHour: number;

  @Column({ default: false })
  isSent: boolean;

  @Column({ nullable: true })
  sentAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}