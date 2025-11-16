import { Member } from "../../entity/Member";

export interface ICreateMemberRequest {
  name: string;
  email: string;
  roleId: string;
  companyId: string;
  countryCode: string;
  phone: string;
  location?: string;
  bio?: string;
  skills?: string[];
  isAdmin?: boolean;
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
  companyMemberId: string;
  isInvited: boolean, 
  isOwner:boolean,
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
  role?: string;
  phone?: string | null;
  countryCode?: string | null;
  location?: string | null;
  bio?: string | null;
  skills?: string[];
  profilePhoto?: string | null;
  isAdmin?: boolean;
  roleId?: string;
  ringColor?: string;
}

export interface IUpdateMemberResponse {
  success: boolean;
  message: string;
  member?: Member;
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
  profilePhoto: string,
  name: string;
  email: string;
  role: string;
  roleId: string;
  isAdmin: boolean;
  companyMemberId: string;
  phone: string;
  countryCode: string;
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

export interface IToggleMemberStatusResponse {
  success: boolean;
  message: string;
  member?: Member & {
    active?: boolean;
    companyMemberId?: string;
  };
  newStatus: boolean;
}

export interface IGetMembersWithProjectsRequest {
  companyId: string;
  memberId?: string;
}

export interface IGetMembersWithProjectsResponse {
  success: boolean;
  message: string;
  members?: IMemberWithProjectsResponse[];
  totalCount?: number;
  summary?: {
    totalProjects: number;
    currentProjects: number;
    upcomingProjects: number;
    asOfDate: string;
  };
}

export interface IMemberWithProjectsResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  roleId: string;
  phone: string;
  countryCode: string;
  location: string;
  bio: string;
  profilePhoto: string;
  ringColor: string;
  active: boolean;
  skills: string[];
  companyId: string;
  projects: IProjectWithStatusResponse[];
}

export interface IProjectWithStatusResponse {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  color: string;
  assignedTo: string;
  startHour: string | null;
  endHour: string | null;
  location: string | null;
  description: string | null;
  client: string | null;
  newRole: string;
  roleId: string;
  brief: string | null;
  logistics: string | null;
  status: 'current' | 'upcoming';
}
export interface IToggleAdminRequest {
  memberId: string;
}

export interface IToggleAdminResponse {
  success: boolean;
  message: string;
  member?: Member & {
    isAdmin?: boolean;
    active?: boolean;
    companyMemberId?: string;
  };
  isAdmin: boolean;
}