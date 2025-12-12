import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from "typeorm";
import { Member } from "./Member";
import { Events } from "./Events";
import { Role } from "./Role";

@Entity()
export class EventAssignment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Events, (events) => events.assignments, { onDelete: "CASCADE" })
  @JoinColumn()
  events: Events;

  @ManyToOne(() => Member, (member) => member.eventAssignments, { onDelete: "CASCADE" })
  @JoinColumn()
  member: Member;

  @ManyToOne(() => Role, (role) => role.eventAssignments, { onDelete: "RESTRICT" })
  @JoinColumn()
  role: Role;

  @Column({ type: "text", nullable: true })
  instructions: string;

  @Column({ nullable: true })
  googleEventId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
  project: any;
}
