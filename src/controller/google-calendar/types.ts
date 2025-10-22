import { IClient, IProjectSection } from "../../entity/Project";

export interface IGetAllProjectsByMemberRequest {
  memberId: string;
  companyId: string;
}

export interface IProjectAssignment {
  id: string;
  name: string;
  color: string;
  startDate: string | null;
  endDate: string | null;
  startHour: number | null;
  endHour: number | null;
  location: string | null;
  description: string | null;
  client: IClient | null;
   brief: IProjectSection[]; // Change from string to array
  logistics: IProjectSection[];
  assignmentRole: string;
  assignedAt: string;
}

export interface IGetAllProjectsByMemberResponse {
  success: boolean;
  message: string;
  projects: IProjectAssignment[];
  totalCount: number;
  member?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}