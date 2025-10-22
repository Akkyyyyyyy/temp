// src/modules/project/types.ts

import { MemberRole } from "../../entity/Member";
import { IClient, IProjectSection, Project } from "../../entity/Project";

export interface IProjectAssignmentInput {
    memberId: string;
    role: MemberRole;
}

export interface ICreateProjectRequest {
    name: string;
    color: string;
    startDate: string;
    endDate: string;
    startHour: number;
    endHour: number;
    client: IClient;
    location: string;
    description?: string;
    companyId: string;
    assignments?: IProjectAssignmentInput[];
}

export interface ICreateProjectResponse {
    success:boolean;
    message: string;
    projectId?: string;
}

export interface ICheckProjectNameRequest {
  name: string;
  companyId: string;
}

export interface ICheckProjectNameResponse {
  success: boolean;
  exists: boolean;
  message?: string;
}
export interface IRemoveMemberFromProjectRequest {
    projectId: string;
    memberId: string;
}

export interface IRemoveMemberFromProjectResponse {
    success: boolean;
    message: string;
}
// src/modules/project/types.ts

export interface IAddMemberToProjectRequest {
    projectId: string;
    memberId: string;
    role: string;
}

export interface IAddMemberToProjectResponse {
    success: boolean;
    message: string;
    assignmentId?: string;
}

export interface IUpdateProjectSectionRequest {
  projectId: string;
  sectionType: 'brief' | 'logistics';
  sections: IProjectSection[];
}

export interface IUpdateProjectSectionResponse {
  success: boolean;
  message: string;
  sections?: IProjectSection[];
}
// Add to your existing types
export interface IEditProjectRequest {
    projectId: string;
    name?: string;
    color?: string;
    startDate?: string;
    endDate?: string;
    startHour?: number;
    endHour?: number;
    location?: string;
    description?: string;
    client?: {
        name: string;
        email: string;
        mobile: string;
    } | null;
    isScheduleUpdate?: boolean;
}

export interface IEditProjectResponse {
    success: boolean;
    message: string;
    project?: Project;
    conflicts?:any[];
}

export interface IDeleteProjectRequest {
    projectId: string;
}

export interface IDeleteProjectResponse {
    success: boolean;
    message: string;
}