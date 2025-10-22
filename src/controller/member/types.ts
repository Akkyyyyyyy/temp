import { Member, MemberRole } from "../../entity/Member";

export interface ICreateMemberRequest {
  name: string;
  email: string;
  role: MemberRole;
  companyId: string;
}
export interface ICreateMemberResponse {
  success: Boolean;
  message: String;
  member?: Member;
}
export interface IGetMembersByCompanyRequest {
  companyId: string;
  month: number;
  year: number;
  week: number;
  viewType?: 'month' | 'week';
  memberId?: string;
}

export interface IProjectResponse {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  color: string;
  assignedTo: string;
  startHour?: number;
  endHour?: number;
}

export interface IMemberResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string;
  location: string;
  bio: string;
  skills: string[];
  companyId: string;
  projects?: IProjectResponse[];
}

export interface IGetMembersByCompanyResponse {
  success: boolean;
  message: string;
  members?: IMemberResponse[];
  totalCount?: number;
  viewType?: 'month' | 'week';
  month?: number;
  year?: number;
  week?: number;
  dateRange?: {
    startDate: string;
    endDate: string;
  };
}

export interface IUpdateMemberRequest {
  name?: string;
  email?: string;
  role?: MemberRole;
  phone?: string | null;
  location?: string | null;
  bio?: string | null;
  skills?: string[];
  profilePhoto?: string | null;
}

export interface IUpdateMemberResponse {
  success: boolean;
  message: string;
  member?: Member;
}
export interface IForgotPasswordRequest {
  email: string;
}

export interface IVerifyOTPRequest {
  email: string;
  otp: string;
  token: string; // Add token to verify OTP request
}

export interface IResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface IPasswordResetToken {
  email: string;
  otp: string; // Include OTP in the token payload
  type: 'password_reset';
  iat: number;
  exp: number;
}

export interface IVerifiedResetToken {
  email: string;
  type: 'password_reset_verified';
  verifiedAt: number;
  iat: number;
  exp: number;
}
// Add to your types file
export interface IGetAvailableMembersRequest {
  companyId: string;
  startDate: string;
  endDate: string;
  startHour: number;
  endHour: number;
  excludeProjectId?: string;
}

export interface IConflict {
  projectId: string;
  projectName: string;
  startDate: string;
  endDate: string;
  startHour: number;
  endHour: number;
  conflictType: "date_and_time" | "date_only";
}

export interface IAvailableMemberResponse {
  id: string;
  profilePhoto:string,
  name: string;
  email: string;
  role: string;
  phone: string;
  location: string;
  bio: string;
  skills: string[];
  availabilityStatus: "fully_available" | "partially_available" | "unavailable";
  conflicts: IConflict[];
}

export interface IUpdateRingColorRequest {
  ringColor: string;
}

export interface IUpdateRingColorResponse {
  success: boolean;
  message: string;
  member?: Member;
}