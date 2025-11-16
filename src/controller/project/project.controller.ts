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
import { ProjectAssignment } from "../../entity/ProjectAssignment";
import { Role } from "../../entity/Role";
import GoogleCalendarService from "../../utils/GoogleCalendarService";

class ProjectController {
    public createProject = async (
        req: Request<{}, {}, ICreateProjectRequest>,
        res: Response<ICreateProjectResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const {
                name,
                color,
                startDate,
                endDate,
                startHour,
                endHour,
                location,
                description,
                companyId,
                client,
                reminders,
                assignments = []
            } = req.body;
            
            // Enhanced validation
            if (!name?.trim()) {
                return res.status(400).json({ success: false, message: "Project name is required" });
            }

            const companyRepo = queryRunner.manager.getRepository(Company);
            const memberRepo = queryRunner.manager.getRepository(Member);
            const projectRepo = queryRunner.manager.getRepository(Project);
            const assignmentRepo = queryRunner.manager.getRepository(ProjectAssignment);
            const roleRepo = queryRunner.manager.getRepository(Role);


            const companyEnt = await companyRepo.findOne({ where: { id: companyId } });
            if (!companyEnt) {
                return res.status(404).json({ success: false, message: "Company not found" });
            }
            
            // 1. Create the project
            const newProject = projectRepo.create({
                name: name.trim(),
                color: color.trim(),
                startDate,
                endDate,
                startHour,
                endHour,
                location: location.trim(),
                description: description?.trim() || "",
                client: client ? {
                    name: client.name.trim(),
                    email: client.email.trim(),
                    mobile: client.mobile.trim(),
                    cc: client.cc
                } : null,
                reminders: reminders || { weekBefore: true, dayBefore: true },
                company: companyEnt
            });

            await projectRepo.save(newProject);

            // 2. Handle member assignments with validation
            const validAssignments: ProjectAssignment[] = [];
            const invalidMemberIds: string[] = [];
            const invalidRoleIds: string[] = [];

            if (assignments.length > 0) {
                for (const assignment of assignments) {
                    const { memberId, roleId, instructions } = assignment;

                    if (!memberId || !roleId) {
                        console.warn(`Skipping assignment with missing memberId or roleId:`, assignment);
                        continue;
                    }

                    // Verify member exists and belongs to company
                    const member = await memberRepo.findOne({
                        where: { id: memberId }
                    });

                    if (!member) {
                        invalidMemberIds.push(memberId);
                        console.warn(`Member with ID ${memberId} not found in company ${companyId}, skipping.`);
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

                    const projectAssignment = assignmentRepo.create({
                        member,
                        project: newProject,
                        role: roleEntity,
                        instructions: instructions?.trim() || null
                    });

                    let googleEventId;
                    const hasAuth = await GoogleCalendarService.hasGoogleAuth(memberId);
                    if (hasAuth) {
                        const googleEvent = await GoogleCalendarService.syncProjectToCalendar(memberId, newProject);
                        googleEventId = googleEvent.eventId;
                    }
                    if (googleEventId) {
                        projectAssignment.googleEventId = googleEventId;
                    }

                    validAssignments.push(projectAssignment);
                }

                // Save all valid assignments at once
                if (validAssignments.length > 0) {
                    await assignmentRepo.save(validAssignments);
                } else {
                    console.warn('No valid assignments were created');
                }

                // Log any invalid assignments
                if (invalidMemberIds.length > 0) {
                    console.warn(`Invalid member IDs: ${invalidMemberIds.join(', ')}`);
                }
                if (invalidRoleIds.length > 0) {
                    console.warn(`Invalid role IDs: ${invalidRoleIds.join(', ')}`);
                }
            } else {
                console.log('No assignments provided in request');
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
                message: "An internal server error occurred while creating the project"
            });
        } finally {
            await queryRunner.release();
        }
    };

    public getProjectById = async (
    req: Request<{ projectId: string }, {}, {}>,
    res: Response<IGetProjectByIdResponse>
) => {
    try {
        const { projectId } = req.params;

        // Validation
        if (!projectId?.trim()) {
            return res.status(400).json({
                success: false,
                message: "Project ID is required"
            });
        }

        const projectRepo = AppDataSource.getRepository(Project);

        // Get project with all relations
        const project = await projectRepo.findOne({
            where: { id: projectId },
            relations: [
                "company",
                "assignments",
                "assignments.member", 
                "assignments.role"
            ],
            select: {
                id: true,
                name: true,
                color: true,
                startDate: true,
                endDate: true,
                startHour: true,
                endHour: true,
                location: true,
                description: true,
                client: true,
                brief: true,
                logistics: true,
                createdAt: true,
                updatedAt: true,
                company: {
                    id: true,
                    name: true
                },
                assignments: {
                    id: true,
                    googleEventId: true,
                    member: {
                        id: true,
                        name: true,
                        email: true,
                        profilePhoto: true,
                        ringColor:true
                    },
                    role: {
                        id: true,
                        name: true
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
        
        // Transform the response to ensure consistent data structure
        const transformedProject = {
            id: project.id,
            name: project.name,
            color: project.color,
            startDate: project.startDate,
            endDate: project.endDate,
            startHour: project.startHour,
            endHour: project.endHour,
            location: project.location,
            description: project.description,
            client: project.client,
            brief: project.brief || [],
            logistics: project.logistics || [],
            company: {
                id: project.company.id,
                name: project.company.name
            },
            assignments: project.assignments?.map(assignment => ({
                id: assignment.id,
                member: {
                    id: assignment.member.id,
                    name: assignment.member.name,
                    email: assignment.member.email,
                    profilePhoto: assignment.member.profilePhoto,
                    ringColor: assignment.member.ringColor
                },
                role: {
                    id: assignment.role?.id,
                    name: assignment.role?.name
                },
                googleEventId: assignment.googleEventId || undefined
            })) || [],
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
        req: Request<{}, {}, IEditProjectRequest>,
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
                startDate,
                endDate,
                startHour,
                endHour,
                location,
                description,
                client,
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
            const assignmentRepo = queryRunner.manager.getRepository(ProjectAssignment);

            // Verify project exists
            const existingProject = await projectRepo.findOne({
                where: { id: projectId },
                relations: ["company", "assignments", "assignments.member"]
            });

            if (!existingProject) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            // Validate dates if provided
            if (startDate && endDate) {
                const start = new Date(startDate);
                const end = new Date(endDate);
                if (start > end) {
                    return res.status(400).json({
                        success: false,
                        message: "End date cannot be before start date"
                    });
                }
            }

            // Validate hours if provided
            if (startHour !== undefined || endHour !== undefined) {
                const finalStartHour = startHour !== undefined ? startHour : existingProject.startHour;
                const finalEndHour = endHour !== undefined ? endHour : existingProject.endHour;

                if (finalStartHour < 0 || finalStartHour > 24 * 60) {
                    return res.status(400).json({
                        success: false,
                        message: "Start hour out of valid range (0 - 1440 minutes)"
                    });
                }

                if (finalEndHour < 0 || finalEndHour > 24 * 60) {
                    return res.status(400).json({
                        success: false,
                        message: "End hour out of valid range (0 - 1440 minutes)"
                    });
                }

                if (finalStartHour >= finalEndHour) {
                    return res.status(400).json({
                        success: false,
                        message: "Start hour must be before end hour"
                    });
                }
            }

            if (isScheduleUpdate && (startDate || endDate || startHour !== undefined || endHour !== undefined)) {
                const conflicts = await this.checkScheduleConflicts(
                    projectId,
                    existingProject.assignments || [],
                    startDate || existingProject.startDate,
                    endDate || existingProject.endDate,
                    startHour !== undefined ? startHour : existingProject.startHour,
                    endHour !== undefined ? endHour : existingProject.endHour,
                    assignmentRepo
                );

                if (conflicts.length > 0) {
                    return res.status(409).json({
                        success: false,
                        message: "Your assigned team member ain't available on this new Schedule",
                        conflicts: conflicts
                    });
                }
            }
            // Validate client data if provided
            if (client !== undefined) {
                if (client === null) {
                    // Clear client information
                    existingProject.client = null;
                } else {
                    // Validate client object
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

                    // Basic email validation
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(client.email)) {
                        return res.status(400).json({
                            success: false,
                            message: "Please provide a valid client email address"
                        });
                    }

                    // Basic mobile validation
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
                    };
                }
            }

            // Update project fields if provided
            if (name !== undefined) existingProject.name = name.trim();
            if (color !== undefined) existingProject.color = color.trim();
            if (startDate !== undefined) existingProject.startDate = startDate;
            if (endDate !== undefined) existingProject.endDate = endDate;
            if (startHour !== undefined) existingProject.startHour = startHour;
            if (endHour !== undefined) existingProject.endHour = endHour;
            if (location !== undefined) existingProject.location = location.trim();
            if (description !== undefined) existingProject.description = description?.trim() || "";

            // Update timestamps
            existingProject.updatedAt = new Date();

            const scheduleChanged =
                startDate !== undefined ||
                endDate !== undefined ||
                startHour !== undefined ||
                endHour !== undefined ||
                name !== undefined ||
                location !== undefined;

            if (scheduleChanged && existingProject.assignments) {
                const updatePromises = existingProject.assignments.map(async (assignment) => {
                    if (assignment.googleEventId) {
                        try {
                            await GoogleCalendarService.editCalendarEvent(
                                assignment.member.id,
                                existingProject,
                                assignment.googleEventId
                            );
                            // console.log(`✅ Updated calendar event for member ${assignment.member.id}`);
                        } catch (error) {
                            console.error(`Failed to update calendar for member ${assignment.member.id}:`, error);
                            // If event not found, try to create new one
                            if (error.message.includes('not found') || error.code === 404) {
                                try {
                                    const syncResult = await GoogleCalendarService.syncProjectToCalendar(
                                        assignment.member.id,
                                        existingProject
                                    );
                                    if (syncResult.success && syncResult.eventId) {
                                        assignment.googleEventId = syncResult.eventId;
                                        await assignmentRepo.save(assignment);
                                        // console.log(`✅ Created new calendar event for member ${assignment.member.id}`);
                                    }
                                } catch (createError) {
                                    console.error(`Failed to create new calendar event for member ${assignment.member.id}:`, createError);
                                }
                            }
                        }
                    } else {
                        // Create new event if doesn't exist but member has auth
                        try {
                            const hasAuth = await GoogleCalendarService.hasGoogleAuth(assignment.member.id);
                            if (hasAuth) {
                                const syncResult = await GoogleCalendarService.syncProjectToCalendar(
                                    assignment.member.id,
                                    existingProject
                                );
                                if (syncResult.success && syncResult.eventId) {
                                    assignment.googleEventId = syncResult.eventId;
                                    await assignmentRepo.save(assignment);
                                    // console.log(`✅ Created calendar event for member ${assignment.member.id}`);
                                }
                            }
                        } catch (createError) {
                            console.error(`Failed to create calendar event for member ${assignment.member.id}:`, createError);
                        }
                    }
                });

                await Promise.allSettled(updatePromises);
            }

            await projectRepo.save(existingProject);
            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Project updated successfully",
                project: existingProject
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error updating project:", error);

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while updating the project"
            });
        } finally {
            await queryRunner.release();
        }
    };

    private async checkScheduleConflicts(
        projectId: string,
        existingAssignments: ProjectAssignment[],
        newStartDate: string,
        newEndDate: string,
        newStartHour: number,
        newEndHour: number,
        assignmentRepo: any
    ): Promise<any[]> {
        const conflicts = [];

        for (const assignment of existingAssignments) {
            const memberId = assignment.member.id;
            const memberName = assignment.member.name;

            // Get all other assignments for this member
            const otherAssignments = await assignmentRepo
                .createQueryBuilder("assignment")
                .leftJoinAndSelect("assignment.project", "project")
                .leftJoinAndSelect("assignment.member", "member")
                .where("assignment.memberId = :memberId", { memberId })
                .andWhere("project.id != :projectId", { projectId })
                .getMany();


            for (const otherAssignment of otherAssignments) {
                const existingProject = otherAssignment.project;

                const hasConflict = this.hasTimeConflict(
                    newStartDate, newEndDate, newStartHour, newEndHour,
                    existingProject.startDate, existingProject.endDate,
                    existingProject.startHour, existingProject.endHour
                );

                if (hasConflict) {
                    conflicts.push({
                        memberId: assignment.member.id,
                        memberName: assignment.member.name,
                        conflictingProjectId: existingProject.id,
                        conflictingProjectName: existingProject.name,
                        conflictingProjectDates: {
                            startDate: existingProject.startDate,
                            endDate: existingProject.endDate,
                            startHour: existingProject.startHour,
                            endHour: existingProject.endHour
                        },
                        newDates: {
                            startDate: newStartDate,
                            endDate: newEndDate,
                            startHour: newStartHour,
                            endHour: newEndHour
                        }
                    });
                }
            }
        }

        return conflicts;
    }

    private hasTimeConflict(
        newStartDate: string, newEndDate: string, newStartHour: number, newEndHour: number,
        existingStartDate: string, existingEndDate: string, existingStartHour: number, existingEndHour: number
    ): boolean {
        const newStart = new Date(newStartDate);
        const newEnd = new Date(newEndDate);
        const existingStart = new Date(existingStartDate);
        const existingEnd = new Date(existingEndDate);

        // No date overlap at all - no conflict
        if (newStart > existingEnd || newEnd < existingStart) {
            return false;
        }

        // Get all overlapping days
        const overlappingDays = this.getOverlappingDays(newStart, newEnd, existingStart, existingEnd);

        // Check each overlapping day for time conflicts
        for (const day of overlappingDays) {
            // For each overlapping day, check if the daily working hours conflict
            const hasTimeOverlap = newStartHour < existingEndHour && newEndHour > existingStartHour;

            if (hasTimeOverlap) {
                return true;
            }
        }
        return false;
    }

    private getOverlappingDays(start1: Date, end1: Date, start2: Date, end2: Date): Date[] {
        const overlappingDays: Date[] = [];
        const overlapStart = new Date(Math.max(start1.getTime(), start2.getTime()));
        const overlapEnd = new Date(Math.min(end1.getTime(), end2.getTime()));


        // If no overlap, return empty array
        if (overlapStart > overlapEnd) {
            return overlappingDays;
        }

        // Add all days in the overlapping range
        const current = new Date(overlapStart);
        while (current <= overlapEnd) {
            overlappingDays.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }

        return overlappingDays;
    }



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
            const assignmentRepo = queryRunner.manager.getRepository(ProjectAssignment);

            // Verify project exists with assignments and member relations
            const project = await projectRepo.findOne({
                where: { id: projectId },
                relations: ["assignments", "assignments.member"] // Important: load member relations
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            // Delete Google Calendar events BEFORE deleting assignments from database
            if (project.assignments && project.assignments.length > 0) {
                // console.log(`🗑️ Deleting Google Calendar events for ${project.assignments.length} assignments`);

                const deletePromises = project.assignments.map(async (assignment) => {
                    // console.log(`Assignment Google Event ID: ${assignment.googleEventId}`);
                    // console.log(`Member ID: ${assignment.member?.id}`);

                    if (assignment.googleEventId && assignment.member?.id) {
                        try {
                            const result = await GoogleCalendarService.deleteCalendarEvent(
                                assignment.member.id,
                                assignment.googleEventId
                            );

                            if (result.success) {
                                // console.log(`✅ Deleted calendar event for member ${assignment.member.id}`);
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
                });

                await Promise.allSettled(deletePromises);
            }

            // Delete all project assignments from database
            if (project.assignments && project.assignments.length > 0) {
                // console.log(`🗑️ Deleting ${project.assignments.length} assignments from database`);
                await assignmentRepo.remove(project.assignments);
            }

            // Delete the project
            // console.log(`🗑️ Deleting project: ${project.name}`);
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
        req: Request<{}, {}, IAddMemberToProjectRequest>,
        res: Response<IAddMemberToProjectResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId, memberId, roleId } = req.body; // Change from 'role' to 'roleId'

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

            if (!roleId?.trim()) { // Change from 'role' to 'roleId'
                return res.status(400).json({
                    success: false,
                    message: "Role ID is required"
                });
            }

            const projectRepo = queryRunner.manager.getRepository(Project);
            const memberRepo = queryRunner.manager.getRepository(Member);
            const assignmentRepo = queryRunner.manager.getRepository(ProjectAssignment);
            const roleRepo = queryRunner.manager.getRepository(Role); // Add role repo

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

            // Verify member exists and belongs to the same company
            const member = await memberRepo.findOne({
                where: {
                    id: memberId,
                },
                relations: ["company"]
            });

            if (!member) {
                return res.status(404).json({
                    success: false,
                    message: "Member not found or does not belong to the project's company"
                });
            }

            // Check if member is already assigned to the project
            const existingAssignment = await assignmentRepo.findOne({
                where: {
                    project: { id: projectId },
                    member: { id: memberId }
                }
            });

            if (existingAssignment) {
                return res.status(409).json({
                    success: false,
                    message: "Member is already assigned to this project"
                });
            }

            // Find the role entity by ID (not name)
            const roleEntity = await roleRepo.findOne({
                where: { id: roleId, company: { id: project.company.id } } // Verify role belongs to company
            });

            if (!roleEntity) {
                return res.status(400).json({
                    success: false,
                    message: "Role not found or doesn't belong to your company"
                });
            }

            // Create new assignment
            const newAssignment = assignmentRepo.create({
                project,
                member,
                role: roleEntity
            });

            let googleEventId: string | null = null;
            try {
                const hasAuth = await GoogleCalendarService.hasGoogleAuth(memberId);

                if (hasAuth) {
                    const syncResult = await GoogleCalendarService.syncProjectToCalendar(memberId, project);
                    if (syncResult.success && syncResult.eventId) {
                        googleEventId = syncResult.eventId;
                        newAssignment.googleEventId = googleEventId;
                    } else {
                        console.warn(`⚠️ Google Calendar sync failed for member ${memberId}: ${syncResult.message}`);
                    }
                } else {
                    // console.log(`ℹ️ Member ${memberId} does not have Google Calendar integration`);
                }
            } catch (googleError) {
                console.error(`❌ Failed to sync to Google Calendar for member ${memberId}:`, googleError);
                // Continue with assignment creation even if Google sync fails
            }

            await assignmentRepo.save(newAssignment);

            await queryRunner.commitTransaction();

            return res.status(201).json({
                success: true,
                message: "Member successfully added to project",
                assignmentId: newAssignment.id
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error adding member to project:", error);

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while adding member to project"
            });
        } finally {
            await queryRunner.release();
        }
    };

    public removeMemberFromProject = async (
        req: Request<{}, {}, IRemoveMemberFromProjectRequest>,
        res: Response<IRemoveMemberFromProjectResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId, memberId } = req.body;

            // console.log(`🔄 Starting member removal: project=${projectId}, member=${memberId}`);

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

            const projectRepo = queryRunner.manager.getRepository(Project);
            const memberRepo = queryRunner.manager.getRepository(Member);
            const assignmentRepo = queryRunner.manager.getRepository(ProjectAssignment);

            // Verify project exists
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

            // Find the assignment with ALL relations needed
            const assignment = await assignmentRepo.findOne({
                where: {
                    project: { id: projectId },
                    member: { id: memberId }
                },
                relations: ["project", "member", "member.company"] // Added member.company for debugging
            });

            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: "Member is not assigned to this project"
                });
            }

            // console.log(`📋 Assignment found:`, {
            //     assignmentId: assignment.id,
            //     googleEventId: assignment.googleEventId,
            //     memberId: assignment.member?.id,
            //     projectId: assignment.project?.id
            // });

            // Check if this is the last member assigned to the project
            const assignmentCount = await assignmentRepo.count({
                where: {
                    project: { id: projectId }
                }
            });

            // console.log(`👥 Assignment count for project: ${assignmentCount}`);

            if (assignmentCount <= 1) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot remove the last member from the project. A project must have at least one member assigned."
                });
            }

            let calendarDeleted = false;
            let calendarError = null;

            // Delete Google Calendar event if exists
            if (assignment.googleEventId) {
                // console.log(`🗑️ Attempting to delete Google Calendar event: ${assignment.googleEventId} for member: ${memberId}`);

                try {
                    const deleteResult = await GoogleCalendarService.deleteCalendarEvent(
                        memberId,
                        assignment.googleEventId
                    );

                    // console.log(`📋 Google Calendar delete result:`, deleteResult);

                    if (deleteResult.success) {
                        calendarDeleted = true;
                        // console.log(`✅ Deleted Google Calendar event for member ${memberId}: ${assignment.googleEventId}`);
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
                // console.log(`ℹ️ No Google Calendar event found for member ${memberId}, skipping deletion`);
            }

            // Remove the assignment
            // console.log(`🗑️ Removing assignment from database`);
            await assignmentRepo.remove(assignment);
            // console.log(`✅ Assignment removed from database`);

            await queryRunner.commitTransaction();
            // console.log(`✅ Transaction committed`);

            const response: IRemoveMemberFromProjectResponse = {
                success: true,
                message: "Member successfully removed from project"
            };

            return res.status(200).json(response);

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("❌ Error removing member from project:", error);

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while removing member from project"
            });
        } finally {
            await queryRunner.release();
            // console.log(`🔚 Query runner released`);
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
                        message: "Section title is required"
                    });
                }

                if (!['text', 'list'].includes(section.type)) {
                    return res.status(400).json({
                        success: false,
                        message: "Section type must be either 'text' or 'list'"
                    });
                }

                // Validate content based on type
                if (section.type === 'text' && typeof section.content !== 'string') {
                    return res.status(400).json({
                        success: false,
                        message: "Text sections must have string content"
                    });
                }

                if (section.type === 'list' && !Array.isArray(section.content)) {
                    return res.status(400).json({
                        success: false,
                        message: "List sections must have array content"
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
}

export default new ProjectController();