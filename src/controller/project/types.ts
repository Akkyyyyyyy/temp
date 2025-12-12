// src/modules/project/types.ts

import { IReminders } from "../../entity/Events";
import { IChecklistItem, IClient, IProjectSection, Project } from "../../entity/Project";

export interface IProjectAssignmentInput {
    memberId: string;
    roleId : string;
    instructions: string;
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
    reminders:IReminders;
    assignments?: any[];
    events:any[];
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
    roleId: string;
}

export interface IAddMemberToProjectResponse {
    success: boolean;
    message: string;
    assignmentId?: string;
    conflicts?: any[];
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
        cc:string;
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

// Add to your existing types
export interface IGetProjectByIdRequest {
    projectId: string;
}

export interface IGetProjectByIdResponse {
    success: boolean;
    message?: string;
    project?: any;
}

export interface GetProjectChecklistRequest {
    projectId: string;
}

export interface GetProjectChecklistResponse {
    success: boolean;
    message?: string;
    checklist?: IChecklistItem[];
}

export interface UpdateProjectChecklistRequest {
    projectId: string;
    checklist: IChecklistItem[];
}

export interface UpdateProjectChecklistResponse {
    success: boolean;
    message: string;
    checklist?: IChecklistItem[];
}
export interface GetProjectEquipmentsResponse {
    success: boolean;
    message?: string;
    equipments?: IProjectSection[];
}

export interface UpdateProjectEquipmentsRequest {
    equipments: IProjectSection[];
}

export interface UpdateProjectEquipmentsResponse {
    success: boolean;
    message: string;
    equipments?: IProjectSection[];
}

// Add to your types file
export interface GetProjectRemindersResponse {
  success: boolean;
  message?: string;
  reminders?: IReminders;
}

export interface UpdateProjectRemindersRequest {
  reminders: IReminders;
}

export interface UpdateProjectRemindersResponse {
  success: boolean;
  message: string;
  reminders?: IReminders;
}
// Update interface names
export interface GetEventRemindersRequest {
    eventId: string;
}

export interface GetEventRemindersResponse {
    success: boolean;
    message?: string;
    reminders?: IReminders;
}

export interface UpdateEventRemindersRequest {
    eventId: string;
    reminders: IReminders;
}

export interface UpdateEventRemindersResponse {
    success: boolean;
    message: string;
    reminders?: IReminders;
}
