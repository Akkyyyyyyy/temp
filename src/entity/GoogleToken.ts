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

  // Helper method to check if token is expired or about to expire
  isExpired(): boolean {
    const now = new Date();
    const buffer = 5 * 60 * 1000; // 5 minutes buffer
    return new Date(this.expiryDate.getTime() - buffer) <= now;
  }

  // Helper method to check if token will expire soon (within 10 minutes)
  willExpireSoon(): boolean {
    const now = new Date();
    const threshold = 10 * 60 * 1000; // 10 minutes
    return new Date(this.expiryDate.getTime() - threshold) <= now;
  }
}