// entity/GoogleToken.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Member } from "./Member";

@Entity()
export class GoogleToken {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @ManyToOne(() => Member, (member) => member.googleTokens, { onDelete: "CASCADE" })
  member: Member;

  @Column({ type: "text" })
  accessToken: string;

  @Column({ type: "text" })
  refreshToken: string;

  @Column({ type: "timestamp" })
  expiryDate: Date;

  @Column({ type: "text", nullable: true })
  scope: string;

  @Column({ type: "text", nullable: true })
  tokenType: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

}