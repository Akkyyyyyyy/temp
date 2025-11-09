import { Member } from "../../entity/Member";
import { Package, PackageStatus } from "../../entity/Package";


export interface ICreatePackageRequest {
  name: string;
  price: number;
  duration: string;
  isPopular?: boolean;
  features?: string[] | null;
  addons?: Record<string, any> | null;
  status: "active" | "inactive";
  memberId: string;
}

export interface IUpdatePackageRequest {
  name?: string;
  price?: number;
  duration?: string;
  isPopular?: boolean;
  features?: string[] | null;
  addons?: Record<string, any> | null;
  status?: "active" | "inactive";
}

export interface IPackageResponse {
  message: string;
  package?: Package;
}

export interface IPackageListResponse {
  message: string;
  packages: Package[];
}