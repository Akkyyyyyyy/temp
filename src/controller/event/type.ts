export interface ICreateEventResponse {
    success: boolean;
    message: string;
    eventId?: string;
    event?: {
        id: string;
        name: string;
        date: string;
        startHour: number;
        endHour: number;
        location: string;
        reminders?: {
            weekBefore: boolean;
            dayBefore: boolean;
        };
        projectId: string;
        assignments?: Array<{
            memberId: string;
            roleId: string;
            memberName?: string;
            roleName?: string;
        }>;
    };
    projectId?: string; // For delete response
}

export interface IEditEventResponse extends ICreateEventResponse { }

export interface IDeleteEventResponse {
    success: boolean;
    message: string;
    eventId?: string;
    projectId?: string;
}