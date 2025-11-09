import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Member } from "./Member";

export type PackageStatus = "active" | "inactive";

export interface IPackage {
  id: string;
  name: string;
  price: number;
  duration: string;
  isPopular: boolean;
  features?: string[] | null;
  addons?: Record<string, any> | null;
  status: PackageStatus;
  member: Member;
  createdAt: Date;
  updatedAt: Date;
}

@Entity()
export class Package implements IPackage {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column("decimal", { precision: 10, scale: 2 })
  price: number;

  @Column()
  duration: string;

  @Column({ default: false })
  isPopular: boolean;

  @Column({ type: "json", nullable: true })
  features: string[] | null;

  @Column({ type: "json", nullable: true })
  addons: Record<string, any> | null;

  @Column({
    type: "enum",
    enum: ["active", "inactive"],
    default: "active",
  })
  status: PackageStatus;

  @ManyToOne(() => Member, (member) => member.packages, { onDelete: "CASCADE" })
  member: Member;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}