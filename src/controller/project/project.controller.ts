// src/modules/project/ProjectController.ts

import { Request, Response } from "express";
import {
    IAddMemberToProjectRequest,
    IAddMemberToProjectResponse,
    ICheckProjectNameRequest,
    ICheckProjectNameResponse,
    ICreateProjectRequest,
    ICreateProjectResponse,
    IDeleteProjectRequest,
    IDeleteProjectResponse,
    IEditProjectRequest,
    IEditProjectResponse,
    IGetProjectByIdResponse,
    IProjectAssignmentInput,
    IRemoveMemberFromProjectRequest,
    IRemoveMemberFromProjectResponse,
    IUpdateProjectSectionRequest,
    IUpdateProjectSectionResponse
} from "./types";
import { AppDataSource } from "../../config/data-source";
import { Project } from "../../entity/Project";
import { Company } from "../../entity/Company";
import { Member } from "../../entity/Member";
// import { ProjectAssignment } from "../../entity/ProjectAssignment";
import { Role } from "../../entity/Role";
import GoogleCalendarService from "../../utils/GoogleCalendarService";
import { CompanyMember } from "../../entity/CompanyMember";
import { In, QueryRunner, Repository } from "typeorm";
import { Events } from "../../entity/Events";
import { EventAssignment } from "../../entity/EventAssignment";
import { sendProjectEventsAssignmentEmail } from "../../utils/mailer";

class ProjectController {
    public createProject = async (
        req: Request<{}, {}, any>,
        res: Response<ICreateProjectResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const {
                name,
                color,
                location,
                description,
                companyId,
                client,
                events = []
            } = req.body;

            // Enhanced validation
            if (!name?.trim()) {
                return res.status(400).json({ success: false, message: "Project name is required" });
            }

            const companyRepo = queryRunner.manager.getRepository(Company);
            const memberRepo = queryRunner.manager.getRepository(Member);
            const projectRepo = queryRunner.manager.getRepository(Project);
            const eventsRepo = queryRunner.manager.getRepository(Events);
            const eventAssignmentRepo = queryRunner.manager.getRepository(EventAssignment);
            const roleRepo = queryRunner.manager.getRepository(Role);

            const companyEnt = await companyRepo.findOne({ where: { id: companyId } });
            if (!companyEnt) {
                return res.status(404).json({ success: false, message: "Company not found" });
            }

            // 1. Create the project
            const newProject = projectRepo.create({
                name: name.trim(),
                color: color.trim(),
                description: description?.trim() || "",
                client: client ? {
                    name: client.name?.trim() || '',
                    email: client.email?.trim() || '',
                    mobile: client.mobile?.trim() || '',
                    cc: client.cc || ''
                } : null,
                company: companyEnt
            });

            await projectRepo.save(newProject);

            // 2. Create events for the project
            const createdEvents: Events[] = [];

            if (events.length > 0) {

                for (const eventData of events) {
                    const {
                        name: eventName,
                        date,
                        startHour: eventStartHour,
                        endHour: eventEndHour,
                        location: eventLocation,
                        reminders: eventReminders,
                        assignments = [] // Get assignments from the event object
                    } = eventData;

                    // Validate event data
                    if (!date) {
                        throw new Error("Event date is required for all events");
                    }

                    if (eventStartHour === undefined || eventEndHour === undefined) {
                        throw new Error("Event start hour and end hour are required");
                    }

                    // Create event
                    const newEvent = eventsRepo.create({
                        name: eventName?.trim() || `${name.trim()} - Event`,
                        date: date,
                        startHour: eventStartHour,
                        endHour: eventEndHour,
                        location: eventLocation?.trim() || location?.trim() || '',
                        reminders: eventReminders || { weekBefore: true, dayBefore: true },
                        project: newProject
                    });

                    const savedEvent = await eventsRepo.save(newEvent);
                    createdEvents.push(savedEvent);

                    // Handle event assignments from the event object
                    if (assignments.length > 0) {
                        await this.handleEventAssignments(
                            assignments,
                            savedEvent,
                            companyId,
                            memberRepo,
                            roleRepo,
                            eventAssignmentRepo,
                            queryRunner
                        );
                    } else {
                        console.log(`No assignments found for event ${eventData.id}`);
                    }
                }
            } else {
                throw new Error("At least one event is required to create a project");
            }

            await queryRunner.commitTransaction();

            return res.status(201).json({
                success: true,
                message: "Project created successfully",
                projectId: newProject.id,
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error creating project:", error);

            return res.status(500).json({
                success: false,
                message: error.message || "An internal server error occurred while creating the project"
            });
        } finally {
            await queryRunner.release();
        }
    };

    // Helper method to handle event assignments
    public handleEventAssignments = async (
        assignments: any[],
        event: Events,
        companyId: string,
        memberRepo: Repository<Member>,
        roleRepo: Repository<Role>,
        eventAssignmentRepo: Repository<EventAssignment>,
        queryRunner: QueryRunner
    ) => {
        const validAssignments: EventAssignment[] = [];
        const invalidMemberIds: string[] = [];
        const invalidRoleIds: string[] = [];

        for (const assignment of assignments) {
            const { memberId, roleId, instructions } = assignment;

            if (!memberId || !roleId) {
                console.warn(`Skipping assignment with missing memberId or roleId:`, assignment);
                continue;
            }

            // Verify member exists
            const member = await memberRepo.findOne({
                where: { id: memberId }
            });

            if (!member) {
                invalidMemberIds.push(memberId);
                console.warn(`Member with ID ${memberId} not found, skipping.`);
                continue;
            }

            // Verify role exists and belongs to company
            const roleEntity = await roleRepo.findOne({
                where: { id: roleId, company: { id: companyId } }
            });

            if (!roleEntity) {
                invalidRoleIds.push(roleId);
                console.warn(`Role with ID '${roleId}' not found or doesn't belong to company, skipping assignment for member ${memberId}`);
                continue;
            }

            const eventAssignment = eventAssignmentRepo.create({
                member,
                events: event,
                role: roleEntity,
                instructions: instructions?.trim() || null
            });

            let googleEventId;
            const hasAuth = await GoogleCalendarService.hasGoogleAuth(memberId);
            if (hasAuth) {
                const googleEvent = await GoogleCalendarService.syncEventToCalendar(
                    memberId,
                    event,
                    eventAssignment.id
                );
                if (googleEvent.success && googleEvent.eventId) {
                    googleEventId = googleEvent.eventId;
                }
            }
            if (googleEventId) {
                eventAssignment.googleEventId = googleEventId;
            }

            validAssignments.push(eventAssignment);
        }

        // Save all valid assignments at once
        if (validAssignments.length > 0) {
            await eventAssignmentRepo.save(validAssignments);
        } else {
            console.warn('No valid assignments were created for event:', event.id);
        }

        // Log any invalid assignments
        if (invalidMemberIds.length > 0) {
            console.warn(`Invalid member IDs: ${invalidMemberIds.join(', ')}`);
        }
        if (invalidRoleIds.length > 0) {
            console.warn(`Invalid role IDs: ${invalidRoleIds.join(', ')}`);
        }
    };

    public getProjectById = async (
        req: Request<{ projectId: string }, {}, {}>,
        res: Response<IGetProjectByIdResponse>
    ) => {
        try {
            const { projectId } = req.params;
            const companyId = res.locals.token?.companyId;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required"
                });
            }

            const projectRepo = AppDataSource.getRepository(Project);
            const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

            // Get project with all relations - UPDATED for new flow
            const project = await projectRepo.findOne({
                where: { id: projectId },
                relations: [
                    "company",
                    "events", // Get all events
                    "events.assignments", // Get assignments for each event
                    "events.assignments.member",
                    "events.assignments.role"
                ],
                select: {
                    id: true,
                    name: true,
                    color: true,
                    description: true,
                    client: true,
                    brief: true,
                    logistics: true,
                    checklist: true,
                    equipments: true,
                    moodBoard: true,
                    createdAt: true,
                    updatedAt: true,
                    company: {
                        id: true,
                        name: true
                    },
                    events: {
                        id: true,
                        name: true,
                        date: true,
                        startHour: true,
                        endHour: true,
                        location: true,
                        reminders: true,
                        createdAt: true,
                        updatedAt: true,
                        assignments: {
                            id: true,
                            googleEventId: true,
                            instructions: true,
                            member: {
                                id: true,
                                email: true,
                            },
                            role: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            // Get company-specific member details for all event assignments
            const eventsWithCompanyDetails = await Promise.all(
                project.events.map(async (event) => {
                    const assignmentsWithCompanyDetails = await Promise.all(
                        event.assignments.map(async (assignment) => {
                            // Find the company member relationship to get company-specific details
                            const companyMember = await companyMemberRepo.findOne({
                                where: {
                                    member: { id: assignment.member.id },
                                    company: { id: project.company.id }
                                },
                                relations: ["member", "role"],
                                select: {
                                    id: true,
                                    name: true,
                                    profilePhoto: true,
                                    ringColor: true,
                                    role: {
                                        id: true,
                                        name: true
                                    },
                                    member: {
                                        id: true,
                                        email: true
                                    }
                                }
                            });

                            return {
                                id: assignment.id,
                                member: {
                                    id: assignment.member.id,
                                    name: companyMember?.name,
                                    email: assignment.member.email,
                                    profilePhoto: companyMember?.profilePhoto || null,
                                    ringColor: companyMember?.ringColor || null
                                },
                                role: {
                                    id: assignment.role?.id,
                                    name: assignment.role?.name
                                },
                                instructions: assignment.instructions,
                                googleEventId: assignment.googleEventId || undefined
                            };
                        })
                    );

                    return {
                        id: event.id,
                        name: event.name,
                        date: event.date,
                        startHour: event.startHour,
                        endHour: event.endHour,
                        location: event.location,
                        reminders: event.reminders,
                        assignments: assignmentsWithCompanyDetails,
                        createdAt: event.createdAt,
                        updatedAt: event.updatedAt
                    };
                })
            );

            // Transform the response to ensure consistent data structure
            const transformedProject = {
                id: project.id,
                name: project.name,
                color: project.color,
                description: project.description,
                client: project.client,
                brief: project.brief || [],
                logistics: project.logistics || [],
                checklist: project.checklist || [],
                equipments: project.equipments || [],
                moodBoard: project.moodBoard || { folders: {}, uploads: {} },
                company: {
                    id: project.company.id,
                    name: project.company.name
                },
                events: eventsWithCompanyDetails, // Now events contain assignments
                createdAt: project.createdAt,
                updatedAt: project.updatedAt
            };

            return res.status(200).json({
                success: true,
                project: transformedProject
            });

        } catch (error) {
            console.error("Error fetching project:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while fetching the project"
            });
        }
    };

    public editProject = async (
        req: Request<{}, {}, any>,
        res: Response<IEditProjectResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const {
                projectId,
                name,
                color,
                description,
                client,
                events = [],
                isScheduleUpdate
            } = req.body;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required"
                });
            }

            const projectRepo = queryRunner.manager.getRepository(Project);
            const eventsRepo = queryRunner.manager.getRepository(Events);
            const eventAssignmentRepo = queryRunner.manager.getRepository(EventAssignment);
            const memberRepo = queryRunner.manager.getRepository(Member);
            const roleRepo = queryRunner.manager.getRepository(Role);

            const existingProject = await projectRepo.findOne({
                where: { id: projectId },
                relations: [
                    "company",
                    "events",
                    "events.assignments",
                    "events.assignments.member",
                    "events.assignments.role"
                ]
            });

            if (!existingProject) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            // Validate client data if provided
            if (client !== undefined) {
                if (client === null) {
                    existingProject.client = null;
                } else {
                    if (!client.name?.trim()) {
                        return res.status(400).json({
                            success: false,
                            message: "Client name is required"
                        });
                    }
                    if (!client.email?.trim()) {
                        return res.status(400).json({
                            success: false,
                            message: "Client email is required"
                        });
                    }
                    if (!client.mobile?.trim()) {
                        return res.status(400).json({
                            success: false,
                            message: "Client mobile is required"
                        });
                    }

                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(client.email)) {
                        return res.status(400).json({
                            success: false,
                            message: "Please provide a valid client email address"
                        });
                    }

                    const mobileRegex = /^[+]?[\d\s\-()]+$/;
                    if (!mobileRegex.test(client.mobile)) {
                        return res.status(400).json({
                            success: false,
                            message: "Please provide a valid client mobile number"
                        });
                    }

                    existingProject.client = {
                        name: client.name.trim(),
                        email: client.email.trim(),
                        mobile: client.mobile.trim(),
                        cc: client.cc
                    };
                }
            }
            if (name !== undefined && existingProject.name !== name.trim()) {
                existingProject.name = name.trim();

                // Save the project first
                await projectRepo.save(existingProject);

                // Then update Google Calendar for all events
                await this.updateGoogleCalendarForAllProjectEvents(existingProject, eventsRepo, eventAssignmentRepo);
            }
            // Update project fields if provided
            if (name !== undefined) existingProject.name = name.trim();
            if (color !== undefined) existingProject.color = color.trim();
            if (description !== undefined) existingProject.description = description?.trim() || "";

            // Handle events updates
            if (events.length > 0) {
                const existingEventsMap = new Map(existingProject.events.map(event => [event.id, event]));
                const eventsToKeep: string[] = [];

                for (const eventData of events) {
                    let event: Events;

                    if (eventData.id && existingEventsMap.has(eventData.id)) {
                        // Update existing event
                        event = existingEventsMap.get(eventData.id)!;
                        eventsToKeep.push(eventData.id);
                    } else {
                        // Create new event
                        event = eventsRepo.create({
                            project: existingProject
                        });
                    }

                    // Validate and update event name
                    if (eventData.name !== undefined) {
                        if (!eventData.name.trim()) {
                            return res.status(400).json({
                                success: false,
                                message: "Event name is required"
                            });
                        }
                        event.name = eventData.name.trim();
                    }

                    // Validate event data
                    if (eventData.date !== undefined) {
                        if (!eventData.date.trim()) {
                            return res.status(400).json({
                                success: false,
                                message: "Event date is required"
                            });
                        }
                        event.date = eventData.date;
                    }

                    if (eventData.startHour !== undefined) {
                        if (eventData.startHour < 0 || eventData.startHour > 24 * 60) {
                            return res.status(400).json({
                                success: false,
                                message: "Start hour out of valid range (0 - 1440 minutes)"
                            });
                        }
                        event.startHour = eventData.startHour;
                    }

                    if (eventData.endHour !== undefined) {
                        if (eventData.endHour < 0 || eventData.endHour > 24 * 60) {
                            return res.status(400).json({
                                success: false,
                                message: "End hour out of valid range (0 - 1440 minutes)"
                            });
                        }
                        event.endHour = eventData.endHour;
                    }

                    if (eventData.startHour !== undefined && eventData.endHour !== undefined) {
                        if (eventData.startHour >= eventData.endHour) {
                            return res.status(400).json({
                                success: false,
                                message: "Start hour must be before end hour"
                            });
                        }
                    }

                    if (eventData.location !== undefined) event.location = eventData.location.trim();
                    if (eventData.reminders !== undefined) event.reminders = eventData.reminders;

                    // Save the event first
                    await eventsRepo.save(event);

                    // Handle event assignments with schedule conflict checking
                    if (eventData.assignments !== undefined) {
                        await this.handleEventAssignmentsUpdate(
                            event,
                            eventData.assignments,
                            existingProject.company.id,
                            memberRepo,
                            roleRepo,
                            eventAssignmentRepo,
                            queryRunner,
                            isScheduleUpdate
                        );
                    }

                    // Update Google Calendar for all assignments in this event
                    await this.updateGoogleCalendarForEvent(event, existingProject, eventAssignmentRepo);
                }

                // Remove events that weren't included in the update
                const eventsToRemove = existingProject.events.filter(event => !eventsToKeep.includes(event.id));
                for (const eventToRemove of eventsToRemove) {
                    // Remove associated assignments first
                    await eventAssignmentRepo.delete({ events: { id: eventToRemove.id } });
                    await eventsRepo.remove(eventToRemove);
                }
            }

            // Update timestamps
            existingProject.updatedAt = new Date();

            await projectRepo.save(existingProject);
            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Project updated successfully",
                project: existingProject
            });

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            console.error("Error updating project:", error);

            if (error.status === 409) {
                return res.status(409).json({
                    success: false,
                    message: error.message,
                    conflicts: error.conflicts
                });
            }

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while updating the project"
            });
        } finally {
            await queryRunner.release();
        }
    };

    // Helper method to handle event assignments updates
    private handleEventAssignmentsUpdate = async (
        event: Events,
        assignmentsData: any[],
        companyId: string,
        memberRepo: Repository<Member>,
        roleRepo: Repository<Role>,
        eventAssignmentRepo: Repository<EventAssignment>,
        queryRunner: QueryRunner,
        isScheduleUpdate?: boolean
    ) => {
        const existingAssignmentsMap = new Map(event.assignments?.map(assignment => [assignment.id, assignment]) || []);
        const assignmentsToKeep: string[] = [];

        // Check for schedule conflicts if this is a schedule update
        if (isScheduleUpdate) {
            const conflicts = await this.checkEventScheduleConflicts(
                event.id,
                assignmentsData,
                event.date,
                event.startHour,
                event.endHour,
                eventAssignmentRepo,
                companyId
            );

            if (conflicts.length > 0) {
                throw {
                    status: 409,
                    message: "Your assigned team member ain't available on this new Schedule",
                    conflicts: conflicts
                };
            }
        }

        for (const assignmentData of assignmentsData) {
            let assignment: EventAssignment;

            if (assignmentData.id && existingAssignmentsMap.has(assignmentData.id)) {
                // Update existing assignment
                assignment = existingAssignmentsMap.get(assignmentData.id)!;
                assignmentsToKeep.push(assignmentData.id);
            } else {
                // Create new assignment
                assignment = eventAssignmentRepo.create({
                    events: event
                });
            }

            // Validate and update assignment data
            if (assignmentData.memberId !== undefined) {
                const member = await memberRepo.findOne({ where: { id: assignmentData.memberId } });
                if (!member) {
                    throw { status: 400, message: `Member with ID ${assignmentData.memberId} not found` };
                }
                assignment.member = member;
            }

            if (assignmentData.roleId !== undefined) {
                const role = await roleRepo.findOne({
                    where: { id: assignmentData.roleId, company: { id: companyId } }
                });
                if (!role) {
                    throw { status: 400, message: `Role with ID ${assignmentData.roleId} not found` };
                }
                assignment.role = role;
            }

            if (assignmentData.instructions !== undefined) {
                assignment.instructions = assignmentData.instructions?.trim() || null;
            }

            await eventAssignmentRepo.save(assignment);
        }

        // Remove assignments that weren't included in the update
        const assignmentsToRemove = event.assignments?.filter(assignment => !assignmentsToKeep.includes(assignment.id)) || [];
        for (const assignmentToRemove of assignmentsToRemove) {
            await eventAssignmentRepo.remove(assignmentToRemove);
        }
    };

    private updateGoogleCalendarForEvent = async (
        event: Events,
        project: Project,
        eventAssignmentRepo: Repository<EventAssignment>
    ) => {
        if (!event.assignments || event.assignments.length === 0) {
            return;
        }

        const updatePromises = event.assignments.map(async (assignment) => {
            if (assignment.googleEventId) {
                try {
                    await GoogleCalendarService.editCalendarEvent(
                        assignment.member.id,
                        event,
                        assignment.googleEventId
                    );
                    console.log(`✅ Updated Google Calendar event for member ${assignment.member.id}`);
                } catch (error) {
                    console.error(`❌ Failed to update calendar for member ${assignment.member.id}:`, error);
                    if (error.message.includes('not found') || error.code === 404) {
                        try {
                            const syncResult = await GoogleCalendarService.syncEventToCalendar(
                                assignment.member.id,
                                event,
                                assignment.id
                            );
                            if (syncResult.success && syncResult.eventId) {
                                assignment.googleEventId = syncResult.eventId;
                                await eventAssignmentRepo.save(assignment);
                            }
                        } catch (createError) {
                            console.error(`❌ Failed to create new calendar event:`, createError);
                        }
                    }
                }
            }
        });

        await Promise.allSettled(updatePromises);
    };
    // Helper method to update Google Calendar for all events in a project
    // Helper method to update Google Calendar for all events in a project
    private updateGoogleCalendarForAllProjectEvents = async (
        project: Project,
        eventsRepo: Repository<Events>,
        eventAssignmentRepo: Repository<EventAssignment>
    ) => {
        // Load fresh events with project and company relations
        const freshEvents = await eventsRepo.find({
            where: { project: { id: project.id } },
            relations: [
                "project",
                "project.company", // Make sure company is loaded
                "assignments",
                "assignments.member"
            ]
        });

        if (!freshEvents || freshEvents.length === 0) {
            return;
        }

        const updatePromises = freshEvents.flatMap(event =>
            event.assignments?.map(async (assignment) => {
                if (assignment.googleEventId && assignment.member?.id) {
                    try {
                        const hasAuth = await GoogleCalendarService.hasGoogleAuth(assignment.member.id);
                        if (hasAuth) {
                            // Make sure event has the updated project data
                            event.project = project; // Ensure latest project data

                            await GoogleCalendarService.editCalendarEvent(
                                assignment.member.id,
                                event,
                                assignment.googleEventId
                            );
                            console.log(`✅ Updated Google Calendar event for member ${assignment.member.id} with new project name: ${project.name}`);
                        }
                    } catch (error) {
                        console.error(`❌ Failed to update calendar for member ${assignment.member.id}:`, error);
                        // If event not found, try to sync a new one
                        if (error.message.includes('not found') || error.code === 404) {
                            try {
                                const syncResult = await GoogleCalendarService.syncEventToCalendar(
                                    assignment.member.id,
                                    event,
                                    assignment.id
                                );
                                if (syncResult.success && syncResult.eventId) {
                                    assignment.googleEventId = syncResult.eventId;
                                    await eventAssignmentRepo.save(assignment);
                                }
                            } catch (syncError) {
                                console.error(`❌ Failed to create new calendar event:`, syncError);
                            }
                        }
                    }
                }
            }) || []
        );

        await Promise.allSettled(updatePromises);
    };
    private async checkEventScheduleConflicts(
        eventId: string,
        assignmentsData: any[],
        newDate: string,
        newStartHour: number,
        newEndHour: number,
        eventAssignmentRepo: Repository<EventAssignment>,
        companyId: string
    ): Promise<any[]> {
        const conflicts = [];

        // If no assignments, no conflicts to check
        if (!assignmentsData || assignmentsData.length === 0) {
            return conflicts;
        }

        // Pre-fetch company members for all assignments in this company
        const memberIds = assignmentsData.map(assignment => assignment.memberId).filter(Boolean);
        if (memberIds.length === 0) {
            return conflicts;
        }

        const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
        const companyMembers = await companyMemberRepo.find({
            where: {
                member: { id: In(memberIds) },
                company: { id: companyId }
            },
            relations: ["member", "company"]
        });

        // Create a map for quick lookup
        const companyMemberMap = new Map();
        companyMembers.forEach(cm => {
            companyMemberMap.set(cm.member.id, cm);
        });

        for (const assignmentData of assignmentsData) {
            const memberId = assignmentData.memberId;
            if (!memberId) continue;

            // Get all other event assignments for this member
            const otherAssignments = await eventAssignmentRepo
                .createQueryBuilder("assignment")
                .leftJoinAndSelect("assignment.events", "events")
                .leftJoinAndSelect("events.project", "project")
                .leftJoinAndSelect("project.company", "company")
                .leftJoinAndSelect("assignment.member", "member")
                .leftJoinAndSelect("member.companyMembers", "companyMembers")
                .leftJoinAndSelect("companyMembers.company", "companyMemberCompany")
                .where("assignment.memberId = :memberId", { memberId })
                .andWhere("events.id != :eventId", { eventId })
                .getMany();

            for (const otherAssignment of otherAssignments) {
                const existingEvent = otherAssignment.events;

                if (!existingEvent.date) {
                    continue;
                }

                // Since events are single day, we only need to check same day and time overlap
                const hasConflict = newDate === existingEvent.date &&
                    newStartHour < existingEvent.endHour &&
                    newEndHour > existingEvent.startHour;

                if (hasConflict) {
                    const companyMember = companyMemberMap.get(memberId);

                    let memberName = companyMember?.name;
                    if (!memberName && otherAssignment.member?.companyMembers) {
                        const relevantCompanyMember = otherAssignment.member.companyMembers.find(
                            cm => cm.company?.id === companyId
                        );
                        memberName = relevantCompanyMember?.name;
                    }

                    conflicts.push({
                        memberId: memberId,
                        memberName: memberName || `Member ${memberId}`,
                        conflictingEventId: existingEvent.id,
                        conflictingProjectId: existingEvent.project?.id,
                        conflictingProjectName: existingEvent.project?.name,
                        conflictingEventDate: existingEvent.date,
                        conflictingEventTimes: {
                            startHour: existingEvent.startHour,
                            endHour: existingEvent.endHour
                        },
                        newEventTimes: {
                            date: newDate,
                            startHour: newStartHour,
                            endHour: newEndHour
                        }
                    });
                }
            }
        }

        return conflicts;
    }

    // private hasTimeConflict(
    //     newStartDate: string, newEndDate: string, newStartHour: number, newEndHour: number,
    //     existingStartDate: string, existingEndDate: string, existingStartHour: number, existingEndHour: number
    // ): boolean {
    //     // Since events are single day, we only check same day and time overlap
    //     if (newStartDate !== existingStartDate) {
    //         return false; // Different days, no conflict
    //     }

    //     // Same day, check time overlap
    //     return newStartHour < existingEndHour && newEndHour > existingStartHour;
    // }

    // private getOverlappingDays(start1: Date, end1: Date, start2: Date, end2: Date): Date[] {
    //     const overlappingDays: Date[] = [];
    //     const overlapStart = new Date(Math.max(start1.getTime(), start2.getTime()));
    //     const overlapEnd = new Date(Math.min(end1.getTime(), end2.getTime()));

    //     // If no overlap, return empty array
    //     if (overlapStart > overlapEnd) {
    //         return overlappingDays;
    //     }

    //     // Add all days in the overlapping range
    //     const current = new Date(overlapStart);
    //     while (current <= overlapEnd) {
    //         overlappingDays.push(new Date(current));
    //         current.setDate(current.getDate() + 1);
    //     }

    //     return overlappingDays;
    // }



    public deleteProject = async (
        req: Request<{}, {}, IDeleteProjectRequest>,
        res: Response<IDeleteProjectResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId } = req.body;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required"
                });
            }

            const projectRepo = queryRunner.manager.getRepository(Project);
            const eventsRepo = queryRunner.manager.getRepository(Events);
            const eventAssignmentRepo = queryRunner.manager.getRepository(EventAssignment);

            // Verify project exists with events, assignments and member relations
            const project = await projectRepo.findOne({
                where: { id: projectId },
                relations: [
                    "events",
                    "events.assignments",
                    "events.assignments.member"
                ]
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            if (project.events && project.events.length > 0) {
                console.log(`🗑️ Deleting Google Calendar events for ${project.events.length} events`);

                const deletePromises = project.events.flatMap(event =>
                    event.assignments?.map(async (assignment) => {
                        if (assignment.googleEventId && assignment.member?.id) {
                            try {
                                const result = await GoogleCalendarService.deleteCalendarEvent(
                                    assignment.member.id,
                                    assignment.googleEventId
                                );

                                if (result.success) {
                                    console.log(`✅ Deleted calendar event for member ${assignment.member.id}`);
                                } else {
                                    console.warn(`⚠️ Failed to delete calendar event for member ${assignment.member.id}: ${result.message}`);
                                }
                            } catch (error) {
                                console.error(`❌ Error deleting calendar event for member ${assignment.member.id}:`, error);
                                // Continue with deletion even if calendar delete fails
                            }
                        } else {
                            console.log(`ℹ️ Skipping - no googleEventId or member ID for assignment`);
                        }
                    }) || []
                );

                await Promise.allSettled(deletePromises);
            }

            // Delete all event assignments from database first
            if (project.events && project.events.length > 0) {
                console.log(`🗑️ Deleting assignments from ${project.events.length} events`);

                for (const event of project.events) {
                    if (event.assignments && event.assignments.length > 0) {
                        await eventAssignmentRepo.remove(event.assignments);
                    }
                }
            }

            // Delete all events from database
            if (project.events && project.events.length > 0) {
                console.log(`🗑️ Deleting ${project.events.length} events from database`);
                await eventsRepo.remove(project.events);
            }

            // Delete the project
            console.log(`🗑️ Deleting project: ${project.name}`);
            await projectRepo.remove(project);

            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Project deleted successfully"
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error deleting project:", error);

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while deleting the project"
            });
        } finally {
            await queryRunner.release();
        }
    };

    public checkProjectName = async (
        req: Request<{}, {}, ICheckProjectNameRequest>,
        res: Response<ICheckProjectNameResponse>
    ) => {
        try {
            const { name, companyId } = req.body;

            // Validation
            if (!name?.trim()) {
                return res.status(400).json({
                    success: false,
                    exists: false,
                    message: "Project name is required"
                });
            }

            if (!companyId) {
                return res.status(400).json({
                    success: false,
                    exists: false,
                    message: "Company ID is required"
                });
            }

            const projectRepo = AppDataSource.getRepository(Project);
            const companyRepo = AppDataSource.getRepository(Company);

            // Verify company exists
            const company = await companyRepo.findOne({ where: { id: companyId } });
            if (!company) {
                return res.status(404).json({
                    success: false,
                    exists: false,
                    message: "Company not found"
                });
            }

            // Check if project name already exists in the same company
            const existingProject = await projectRepo.findOne({
                where: {
                    name: name.trim(),
                    company: { id: companyId }
                },
                select: ["id", "name"] // Only select needed fields for performance
            });

            return res.status(200).json({
                success: true,
                exists: !!existingProject,
                message: existingProject
                    ? "Project name already exists in this company"
                    : "Project name is available"
            });

        } catch (error) {
            console.error("Error checking project name:", error);
            return res.status(500).json({
                success: false,
                exists: false,
                message: "An internal server error occurred while checking project name"
            });
        }
    };

    public addMemberToProject = async (
        req: Request<{}, {}, any>,
        res: Response<IAddMemberToProjectResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId, memberId, roleId, eventId } = req.body;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required"
                });
            }

            if (!memberId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Member ID is required"
                });
            }

            if (!roleId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Role ID is required"
                });
            }

            if (!eventId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Event ID is required"
                });
            }

            const projectRepo = queryRunner.manager.getRepository(Project);
            const memberRepo = queryRunner.manager.getRepository(Member);
            const eventsRepo = queryRunner.manager.getRepository(Events);
            const eventAssignmentRepo = queryRunner.manager.getRepository(EventAssignment);
            const roleRepo = queryRunner.manager.getRepository(Role);

            // Verify project exists and get company info
            const project = await projectRepo.findOne({
                where: { id: projectId },
                relations: ["company"]
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            // Verify event exists and belongs to the project
            const event = await eventsRepo.findOne({
                where: {
                    id: eventId,
                    project: { id: projectId }
                },
                relations: ['project', 'project.company']
            });

            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: "Event not found or does not belong to this project"
                });
            }

            // Verify member exists
            const member = await memberRepo.findOne({
                where: { id: memberId }
            });

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: "Member not found"
                });
            }

            // Check if member is already assigned to this event
            const existingAssignment = await eventAssignmentRepo.findOne({
                where: {
                    events: { id: eventId },
                    member: { id: memberId }
                }
            });

            if (existingAssignment) {
                return res.status(409).json({
                    success: false,
                    message: "Member is already assigned to this event"
                });
            }

            // Check for schedule conflicts
            const scheduleConflicts = await this.checkEventScheduleConflicts(
                eventId,
                [{ memberId }], // Pass as array for consistency with your method signature
                event.date,
                event.startHour,
                event.endHour,
                eventAssignmentRepo,
                project.company.id
            );

            if (scheduleConflicts.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: "Schedule conflict detected",
                    conflicts: scheduleConflicts
                });
            }

            // Find the role entity by ID
            const roleEntity = await roleRepo.findOne({
                where: { id: roleId, company: { id: project.company.id } }
            });

            if (!roleEntity) {
                return res.status(400).json({
                    success: false,
                    message: "Role not found or doesn't belong to your company"
                });
            }

            // Create new event assignment
            const newAssignment = eventAssignmentRepo.create({
                events: event,
                member,
                role: roleEntity
            });

            let googleEventId: string | null = null;
            try {
                const hasAuth = await GoogleCalendarService.hasGoogleAuth(memberId);

                if (hasAuth) {
                    // Load event with proper relations for Google Calendar
                    const eventForGoogle = await eventsRepo.findOne({
                        where: { id: eventId },
                        relations: ['project', 'project.company']
                    });

                    if (eventForGoogle) {
                        const syncResult = await GoogleCalendarService.syncEventToCalendar(
                            memberId,
                            eventForGoogle, // Use event with loaded relations
                            newAssignment.id // Pass assignment ID
                        );
                        if (syncResult.success && syncResult.eventId) {
                            googleEventId = syncResult.eventId;
                            newAssignment.googleEventId = googleEventId;
                        } else {
                            console.warn(`⚠️ Google Calendar sync failed for member ${memberId}: ${syncResult.message}`);
                        }
                    }
                } else {
                    console.log(`ℹ️ Member ${memberId} does not have Google Calendar integration`);
                }
            } catch (googleError) {
                console.error(`❌ Failed to sync to Google Calendar for member ${memberId}:`, googleError);
                // Continue with assignment creation even if Google sync fails
            }

            await eventAssignmentRepo.save(newAssignment);

            await queryRunner.commitTransaction();

            return res.status(201).json({
                success: true,
                message: "Member successfully added to event",
                assignmentId: newAssignment.id
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error adding member to event:", error);

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while adding member to event"
            });
        } finally {
            await queryRunner.release();
        }
    };

    public removeMemberFromProject = async (
        req: Request<{}, {}, any>,
        res: Response<IRemoveMemberFromProjectResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId, memberId, eventId } = req.body;
            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required"
                });
            }

            if (!memberId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Member ID is required"
                });
            }

            if (!eventId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Event ID is required"
                });
            }

            const projectRepo = queryRunner.manager.getRepository(Project);
            const memberRepo = queryRunner.manager.getRepository(Member);
            const eventsRepo = queryRunner.manager.getRepository(Events);
            const eventAssignmentRepo = queryRunner.manager.getRepository(EventAssignment);

            // Verify project exists
            const project = await projectRepo.findOne({
                where: { id: projectId },
                relations: ['company']
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            // Verify event exists and belongs to project
            const event = await eventsRepo.findOne({
                where: {
                    id: eventId,
                    project: { id: projectId }
                }
            });
            console.log("memberId",memberId);
            console.log("eventId",eventId);
            console.log("projectId",projectId);

            

            if (!event) {
                return res.status(404).json({
                    success: false,
                    message: "Event not found or does not belong to this project"
                });
            }

            // Verify member exists
            const member = await memberRepo.findOne({
                where: { id: memberId }
            });

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: "Member not found"
                });
            }

            // Find the event assignment
            const assignment = await eventAssignmentRepo.findOne({
                where: {
                    events: { id: eventId },
                    member: { id: memberId }
                },
                relations: ["events",
                    "events.project",
                    "events.project.company",
                    "member"]
            });

            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: "Member is not assigned to this event"
                });
            }

            // Check if this is the last member assigned to the event
            const assignmentCount = await eventAssignmentRepo.count({
                where: {
                    events: { id: eventId }
                }
            });

            // Prevent removal of the last member from an event
            if (assignmentCount <= 1) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot remove the last member from an event. Events must have at least one assigned member."
                });
            }

            let calendarDeleted = false;
            let calendarError = null;

            // Delete Google Calendar event if exists
            if (assignment.googleEventId) {
                try {
                    const deleteResult = await GoogleCalendarService.deleteCalendarEvent(
                        memberId,
                        assignment.googleEventId
                    );

                    if (deleteResult.success) {
                        calendarDeleted = true;
                        console.log(`✅ Deleted Google Calendar event for member ${memberId}: ${assignment.googleEventId}`);
                    } else {
                        calendarError = deleteResult.message;
                        console.warn(`⚠️ Failed to delete Google Calendar event for member ${memberId}: ${deleteResult.message}`);
                    }
                } catch (googleError) {
                    calendarError = googleError.message;
                    console.error(`❌ Error deleting Google Calendar event for member ${memberId}:`, googleError);
                    // Continue with assignment removal even if calendar deletion fails
                }
            } else {
                console.log(`ℹ️ No Google Calendar event found for member ${memberId}, skipping deletion`);
            }

            // Remove the event assignment
            await eventAssignmentRepo.remove(assignment);

            await queryRunner.commitTransaction();

            const response: IRemoveMemberFromProjectResponse = {
                success: true,
                message: "Member successfully removed from event"
            };

            return res.status(200).json(response);

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("❌ Error removing member from event:", error);

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while removing member from event"
            });
        } finally {
            await queryRunner.release();
        }
    };

    public updateProjectSection = async (
        req: Request<{}, {}, IUpdateProjectSectionRequest>,
        res: Response<IUpdateProjectSectionResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId, sectionType, sections } = req.body;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required"
                });
            }

            if (!['brief', 'logistics'].includes(sectionType)) {
                return res.status(400).json({
                    success: false,
                    message: "Section type must be either 'brief' or 'logistics'"
                });
            }

            if (!Array.isArray(sections)) {
                return res.status(400).json({
                    success: false,
                    message: "Sections must be an array"
                });
            }

            const projectRepo = queryRunner.manager.getRepository(Project);

            // Verify project exists
            const project = await projectRepo.findOne({
                where: { id: projectId }
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            // Validate each section
            for (const section of sections) {
                if (!section.title?.trim()) {
                    return res.status(400).json({
                        success: false,
                        message: "Title is required and cannot be empty"
                    });
                }

                if (!['text', 'list'].includes(section.type)) {
                    return res.status(400).json({
                        success: false,
                        message: "Section type must be either 'text' or 'list'"
                    });
                }

                // Validate content based on type - content must exist and not be empty
                if (section.type === 'text') {
                    if (typeof section.content !== 'string') {
                        return res.status(400).json({
                            success: false,
                            message: "Text sections must have string content"
                        });
                    }
                    if (!section.content.trim()) {
                        return res.status(400).json({
                            success: false,
                            message: "Content cannot be empty"
                        });
                    }
                }

                if (section.type === 'list') {
                    if (!Array.isArray(section.content)) {
                        return res.status(400).json({
                            success: false,
                            message: "List sections must have array content"
                        });
                    }
                    if (section.content.length === 0) {
                        return res.status(400).json({
                            success: false,
                            message: "Content cannot be empty"
                        });
                    }
                    // Optional: Validate that list items are not empty strings
                    for (const item of section.content) {
                        if (typeof item !== 'string' || !item.trim()) {
                            return res.status(400).json({
                                success: false,
                                message: "Content cannot be empty"
                            });
                        }
                    }
                }

                // Ensure content property exists
                if (!section.hasOwnProperty('content')) {
                    return res.status(400).json({
                        success: false,
                        message: "Content is required"
                    });
                }
            }

            // Update the project section
            if (sectionType === 'brief') {
                project.brief = sections;
            } else {
                project.logistics = sections;
            }

            await projectRepo.save(project);
            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: `${sectionType} sections updated successfully`,
                sections: sections
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error(`Error updating ${req.body.sectionType} sections:`, error);

            return res.status(500).json({
                success: false,
                message: `An internal server error occurred while updating ${req.body.sectionType} sections`
            });
        } finally {
            await queryRunner.release();
        }
    };

    public getProjectSections = async (
        req: Request,
        res: Response
    ) => {
        try {
            const { projectId } = req.params;

            if (!projectId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required"
                });
            }

            const projectRepo = AppDataSource.getRepository(Project);

            const project = await projectRepo.findOne({
                where: { id: projectId },
                select: ["id", "brief", "logistics"]
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            return res.status(200).json({
                success: true,
                data: {
                    brief: project.brief || [],
                    logistics: project.logistics || []
                }
            });

        } catch (error) {
            console.error("Error fetching project sections:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while fetching project sections"
            });
        }
    };

    private async sendConsolidatedEventAssignmentEmails(
        memberAssignments: Map<string, {
            member: any,
            events: Array<{
                eventName: string;
                eventDate: string;
                startHour: string;
                endHour: string;
                location: string;
            }>,
            companyMember: any
        }>,
        projectName: string,
        companyName: string
    ) {
        let totalEmailsSent = 0;

        for (const [memberId, assignment] of memberAssignments.entries()) {
            try {
                await sendProjectEventsAssignmentEmail(
                    assignment.member.email,
                    assignment.companyMember?.name || 'Team Member',
                    projectName,
                    assignment.events,
                    companyName
                );

                totalEmailsSent++;
                console.log(`   ✅ Sent consolidated event assignment email to ${assignment.member.email} with ${assignment.events.length} event(s)`);
            } catch (emailError) {
                console.error(`     ❌ Failed to send email to ${assignment.member.email}:`, emailError.message || emailError);
            }
        }

        return totalEmailsSent;
    }

}

export default new ProjectController();