import { Member } from "../../entity/Member";
import { PackageStatus } from "../../entity/Package";


export interface ICreatePackageRequest {
  name: string;
  price: number;
  duration: string;
  isPopular: boolean;
  features?: Record<string, any> | null;
  addons?: Record<string, any> | null;
  status: PackageStatus;
  memberId: string;
}

export interface IUpdatePackageRequest {
  name?: string;
  price?: number;
  duration?: string;
  isPopular?: boolean;
  features?: Record<string, any> | null;
  addons?: Record<string, any> | null;
  status?: PackageStatus;
}

export interface IPackageResponse {
  message: string;
  package?: {
    id: string;
    name: string;
    price: number;
    duration: string;
    isPopular: boolean;
    features: Record<string, any> | null;
    addons: Record<string, any> | null;
    status: PackageStatus;
    member: Member;
    createdAt: Date;
    updatedAt: Date;
  };
}

export interface IPackageListResponse {
  message: string;
  packages: {
    id: string;
    name: string;
    price: number;
    duration: string;
    isPopular: boolean;
    features: Record<string, any> | null;
    addons: Record<string, any> | null;
    status: PackageStatus;
    member: Member;
    createdAt: Date;
    updatedAt: Date;
  }[];
}