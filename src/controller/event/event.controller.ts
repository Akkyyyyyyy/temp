import { Request, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { Company } from "../../entity/Company";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Member } from "../../entity/Member";
import { In, QueryRunner, Repository } from "typeorm";
import { ICreateEventResponse, IDeleteEventResponse, IEditEventResponse } from "./type";
import { Events } from "../../entity/Events";
import { Project } from "../../entity/Project";
import { Role } from "../../entity/Role";
import { EventAssignment } from "../../entity/EventAssignment";
import GoogleCalendarService from "../../utils/GoogleCalendarService";



class EventController {
    public createEvent = async (
        req: Request<{}, {}, any>,
        res: Response<ICreateEventResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const {
                name,
                date,
                startHour,
                endHour,
                location,
                reminders,
                projectId,
                companyId,
                assignments = []
            } = req.body;

            // Validation
            if (!date) {
                return res.status(400).json({ success: false, message: "Event date is required" });
            }

            if (startHour === undefined || endHour === undefined) {
                return res.status(400).json({ success: false, message: "Event start hour and end hour are required" });
            }

            if (!projectId) {
                return res.status(400).json({ success: false, message: "Project ID is required" });
            }

            if (!companyId) {
                return res.status(400).json({ success: false, message: "Company ID is required" });
            }

            const eventsRepo = queryRunner.manager.getRepository(Events);
            const projectRepo = queryRunner.manager.getRepository(Project);
            const companyRepo = queryRunner.manager.getRepository(Company);
            const memberRepo = queryRunner.manager.getRepository(Member);
            const roleRepo = queryRunner.manager.getRepository(Role);
            const eventAssignmentRepo = queryRunner.manager.getRepository(EventAssignment);

            // Check if project exists
            const project = await projectRepo.findOne({
                where: {
                    id: projectId,
                    company: { id: companyId }
                },
                relations: ['company']
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found or doesn't belong to the specified company"
                });
            }

            // Check if company exists
            const company = await companyRepo.findOne({ where: { id: companyId } });
            if (!company) {
                return res.status(404).json({ success: false, message: "Company not found" });
            }

            // Create the event
            const newEvent = eventsRepo.create({
                name: name?.trim() || `${project.name} - Event`,
                date: date,
                startHour: startHour,
                endHour: endHour,
                location: location?.trim(),
                reminders: reminders || { weekBefore: true, dayBefore: true },
                project: project
            });

            const savedEvent = await eventsRepo.save(newEvent);

            // Handle event assignments
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
            }
            await this.syncEventToGoogleCalendar(savedEvent, eventAssignmentRepo);

            await queryRunner.commitTransaction();

            return res.status(201).json({
                success: true,
                message: "Event created successfully",
                eventId: savedEvent.id,
                event: {
                    id: savedEvent.id,
                    name: savedEvent.name,
                    date: savedEvent.date,
                    startHour: savedEvent.startHour,
                    endHour: savedEvent.endHour,
                    location: savedEvent.location,
                    projectId: savedEvent.project.id
                }
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error creating event:", error);

            return res.status(500).json({
                success: false,
                message: error.message || "An internal server error occurred while creating the event"
            });
        } finally {
            await queryRunner.release();
        }
    };
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
            try {
                const hasAuth = await GoogleCalendarService.hasGoogleAuth(memberId);
                if (hasAuth) {
                    const syncResult = await GoogleCalendarService.syncEventToCalendar(
                        memberId,
                        event,
                        eventAssignment.id // Pass assignment ID
                    );
                    if (syncResult.success && syncResult.eventId) {
                        googleEventId = syncResult.eventId;
                    }
                }
            } catch (googleError) {
                console.error(`Failed to sync to Google Calendar for member ${memberId}:`, googleError);
                // Continue even if Google sync fails
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

    private async syncEventToGoogleCalendar(
        event: Events,
        eventAssignmentRepo: Repository<EventAssignment>
    ) {
        try {
            // Load event with assignments and project relations
            const eventWithAssignments = await eventAssignmentRepo
                .createQueryBuilder('assignment')
                .leftJoinAndSelect('assignment.events', 'event')
                .leftJoinAndSelect('assignment.member', 'member')
                .leftJoinAndSelect('event.project', 'project')
                .leftJoinAndSelect('project.company', 'company')
                .where('assignment.events.id = :eventId', { eventId: event.id })
                .getMany();

            if (!eventWithAssignments || eventWithAssignments.length === 0) {
                return;
            }

            const syncPromises = eventWithAssignments.map(async (assignment) => {
                try {
                    const hasAuth = await GoogleCalendarService.hasGoogleAuth(assignment.member.id);
                    if (hasAuth) {
                        const syncResult = await GoogleCalendarService.syncEventToCalendar(
                            assignment.member.id,
                            event,
                            assignment.id
                        );

                        if (syncResult.success && syncResult.eventId && !assignment.googleEventId) {
                            assignment.googleEventId = syncResult.eventId;
                            await eventAssignmentRepo.save(assignment);
                        }
                    }
                } catch (error) {
                    console.error(`Failed to sync Google Calendar for member ${assignment.member.id}:`, error);
                }
            });

            await Promise.allSettled(syncPromises);
        } catch (error) {
            console.error('Error syncing event to Google Calendar:', error);
        }
    }
    public editEvent = async (
        req: Request<{ id: string }, {}, any>,
        res: Response<IEditEventResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const eventId = req.params.id;
            const {
                name,
                date,
                startHour,
                endHour,
                location,
                reminders
            } = req.body;

            // Validation
            if (!eventId) {
                return res.status(400).json({ success: false, message: "Event ID is required" });
            }

            if (startHour !== undefined && endHour === undefined) {
                return res.status(400).json({ success: false, message: "End hour is required when start hour is provided" });
            }

            if (endHour !== undefined && startHour === undefined) {
                return res.status(400).json({ success: false, message: "Start hour is required when end hour is provided" });
            }

            if (startHour !== undefined && endHour !== undefined && startHour >= endHour) {
                return res.status(400).json({ success: false, message: "End time must be after start time" });
            }

            const eventsRepo = queryRunner.manager.getRepository(Events);
            const memberRepo = queryRunner.manager.getRepository(Member);
            const eventAssignmentRepo = queryRunner.manager.getRepository(EventAssignment);

            // Check if event exists with assignments
            const existingEvent = await eventsRepo.findOne({
                where: { id: eventId },
                relations: ['project','project.company',  'assignments', 'assignments.member', 'assignments.role']
            });

            if (!existingEvent) {
                return res.status(404).json({ success: false, message: "Event not found" });
            }

            // Check if schedule is being changed
            const isScheduleChanged = (
                (date !== undefined && date !== existingEvent.date) ||
                (startHour !== undefined && startHour !== existingEvent.startHour) ||
                (endHour !== undefined && endHour !== existingEvent.endHour)
            );

            // If schedule is changed and event has assignments, check availability
            if (isScheduleChanged && existingEvent.assignments && existingEvent.assignments.length > 0) {
                const newDate = date !== undefined ? date : existingEvent.date;
                const newStartHour = startHour !== undefined ? startHour : existingEvent.startHour;
                const newEndHour = endHour !== undefined ? endHour : existingEvent.endHour;

                // Get all assignments for this event
                const assignments = existingEvent.assignments;

                // Check each member's availability
                const availabilityIssues: string[] = [];

                for (const assignment of assignments) {
                    const memberId = assignment.member.id;

                    // Check if member is available at the new time
                    const isAvailable = await this.isMemberAvailable(
                        memberId,
                        eventId, // Exclude current event when checking availability
                        newDate,
                        newStartHour,
                        newEndHour,
                        queryRunner
                    );

                    if (!isAvailable) {
                        availabilityIssues.push(` is not available at the new time`);
                    }
                }

                // If there are availability issues, return error
                if (availabilityIssues.length > 0) {
                    await queryRunner.rollbackTransaction();
                    return res.status(400).json({
                        success: false,
                        message: "Assigned team members are not available at the new schedule",
                    });
                }
            }

            // Update event fields
            if (name !== undefined) existingEvent.name = name.trim();
            if (date !== undefined) existingEvent.date = date;
            if (startHour !== undefined) existingEvent.startHour = startHour;
            if (endHour !== undefined) existingEvent.endHour = endHour;
            if (location !== undefined) existingEvent.location = location?.trim();

            // Update reminders if provided
            if (reminders !== undefined) {
                existingEvent.reminders = {
                    weekBefore: reminders.weekBefore !== undefined ? reminders.weekBefore : existingEvent.reminders.weekBefore,
                    dayBefore: reminders.dayBefore !== undefined ? reminders.dayBefore : existingEvent.reminders.dayBefore
                };
            }

            // Update event
            const updatedEvent = await eventsRepo.save(existingEvent);

            if (isScheduleChanged || name !== undefined) {
                await this.updateGoogleCalendarForEvent(updatedEvent, eventAssignmentRepo);
            }

            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Event updated successfully",
                eventId: updatedEvent.id,
                event: {
                    id: updatedEvent.id,
                    name: updatedEvent.name,
                    date: updatedEvent.date,
                    startHour: updatedEvent.startHour,
                    endHour: updatedEvent.endHour,
                    location: updatedEvent.location,
                    reminders: updatedEvent.reminders,
                    projectId: updatedEvent.project.id,
                }
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error updating event:", error);

            return res.status(500).json({
                success: false,
                message: error.message || "An internal server error occurred while updating the event"
            });
        } finally {
            await queryRunner.release();
        }
    };

    private async updateGoogleCalendarForEvent(
        event: Events,
        eventAssignmentRepo: Repository<EventAssignment>
    ) {
        try {
            // Load event with assignments
            const eventWithAssignments = await eventAssignmentRepo
                .createQueryBuilder('assignment')
                .leftJoinAndSelect('assignment.events', 'event')
                .leftJoinAndSelect('assignment.member', 'member')
                .leftJoinAndSelect('event.project', 'project')
                .leftJoinAndSelect('project.company', 'company')
                .where('assignment.events.id = :eventId', { eventId: event.id })
                .getMany();

            if (!eventWithAssignments || eventWithAssignments.length === 0) {
                return;
            }

            const updatePromises = eventWithAssignments.map(async (assignment) => {
                if (assignment.googleEventId) {
                    try {
                        const hasAuth = await GoogleCalendarService.hasGoogleAuth(assignment.member.id);
                        if (hasAuth) {
                            await GoogleCalendarService.editCalendarEvent(
                                assignment.member.id,
                                event,
                                assignment.googleEventId
                            );
                            console.log(`✅ Updated Google Calendar for member ${assignment.member.id}`);
                        }
                    } catch (error) {
                        console.error(`❌ Failed to update Google Calendar for member ${assignment.member.id}:`, error);
                        // If event not found, create a new one
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
                                console.error(`❌ Failed to create new Google Calendar event:`, syncError);
                            }
                        }
                    }
                } else {
                    // No existing Google Calendar event, create one
                    try {
                        const hasAuth = await GoogleCalendarService.hasGoogleAuth(assignment.member.id);
                        if (hasAuth) {
                            const syncResult = await GoogleCalendarService.syncEventToCalendar(
                                assignment.member.id,
                                event,
                                assignment.id
                            );
                            if (syncResult.success && syncResult.eventId) {
                                assignment.googleEventId = syncResult.eventId;
                                await eventAssignmentRepo.save(assignment);
                            }
                        }
                    } catch (syncError) {
                        console.error(`❌ Failed to create Google Calendar event:`, syncError);
                    }
                }
            });

            await Promise.allSettled(updatePromises);
        } catch (error) {
            console.error('Error updating Google Calendar for event:', error);
        }
    }

    // Helper function to check member availability
    private async isMemberAvailable(
        memberId: string,
        excludeEventId: string,
        date: string,
        startHour: number,
        endHour: number,
        queryRunner: QueryRunner
    ): Promise<boolean> {
        try {
            const eventsRepo = queryRunner.manager.getRepository(Events);

            // Check if member has any overlapping events (excluding the current event being edited)
            const overlappingEvents = await eventsRepo
                .createQueryBuilder('event')
                .innerJoin('event.assignments', 'assignment')
                .innerJoin('assignment.member', 'member')
                .where('member.id = :memberId', { memberId })
                .andWhere('event.id != :excludeEventId', { excludeEventId })
                .andWhere('event.date = :date', { date })
                .andWhere('(event.startHour < :endHour AND event.endHour > :startHour)', {
                    startHour,
                    endHour
                })
                .getCount();

            return overlappingEvents === 0;
        } catch (error) {
            console.error('Error checking member availability:', error);
            return false; // Default to unavailable if there's an error
        }
    }
    public deleteEvent = async (
        req: Request<{ id: string }, {}, any>,
        res: Response<IDeleteEventResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { eventId } = req.body;

            if (!eventId) {
                return res.status(400).json({ success: false, message: "Event ID is required" });
            }

            const eventsRepo = queryRunner.manager.getRepository(Events);
            const eventAssignmentRepo = queryRunner.manager.getRepository(EventAssignment);

            // Check if event exists
            const existingEvent = await eventsRepo.findOne({
                where: { id: eventId },
                relations: ['project']
            });

            if (!existingEvent) {
                return res.status(404).json({ success: false, message: "Event not found" });
            }

            // Store project ID for response
            const projectId = existingEvent.project.id;
            const assignments = await eventAssignmentRepo.find({
                where: { events: { id: eventId } },
                relations: ['member']
            });

            const deletePromises = assignments.map(async (assignment) => {
                if (assignment.googleEventId && assignment.member?.id) {
                    try {
                        await GoogleCalendarService.deleteCalendarEvent(
                            assignment.member.id,
                            assignment.googleEventId
                        );
                        console.log(`✅ Deleted Google Calendar event for member ${assignment.member.id}`);
                    } catch (error) {
                        console.error(`❌ Failed to delete Google Calendar event:`, error);
                    }
                }
            });
            await Promise.allSettled(deletePromises);
            // First delete assignments (if cascade delete is not set up)
            await eventAssignmentRepo.delete({ events: { id: eventId } });

            // Then delete the event
            await eventsRepo.delete(eventId);

            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Event deleted successfully",
                eventId: eventId,
                projectId: projectId
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error deleting event:", error);

            // Check if it's a foreign key constraint error
            if (error.code === '23503') { // PostgreSQL foreign key violation
                return res.status(400).json({
                    success: false,
                    message: "Cannot delete event because it is referenced by other records. Remove dependencies first."
                });
            }

            return res.status(500).json({
                success: false,
                message: error.message || "An internal server error occurred while deleting the event"
            });
        } finally {
            await queryRunner.release();
        }
    };


};


export default new EventController();
