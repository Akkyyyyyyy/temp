import { Request, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { Project } from "../../entity/Project";
import { ProjectAssignment } from "../../entity/ProjectAssignment";
import { IChecklistItem, IProjectSection } from "../../entity/Project";
import {
    GetProjectChecklistResponse,
    UpdateProjectChecklistRequest,
    UpdateProjectChecklistResponse,
    GetProjectEquipmentsResponse,
    UpdateProjectEquipmentsRequest,
    UpdateProjectEquipmentsResponse,
    GetProjectRemindersResponse,
    UpdateProjectRemindersRequest,
    UpdateProjectRemindersResponse
} from "./types";
import { generateFileKey, uploadToS3 } from "../../utils/s3upload";

// Types for Project Assignments
export interface GetProjectAssignmentsResponse {
    success: boolean;
    message?: string;
    assignments?: AssignmentResponse[];
}

export interface UpdateAssignmentInstructionsRequest {
    instructions: string;
}

export interface UpdateAssignmentInstructionsResponse {
    success: boolean;
    message: string;
    assignment?: AssignmentResponse;
}

interface AssignmentResponse {
    id: string;
    instructions?: string;
    member: {
        id: string;
        name: string;
        email: string;
        profilePhoto?: string;
        ringColor?: string;
    };
    role: {
        id: string;
        name: string;
    };
}

class AdditionalTabsController {

    // GET /project/:projectId/checklist
    public getProjectChecklist = async (
        req: Request<{ projectId: string }, {}, {}>,
        res: Response<GetProjectChecklistResponse>
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

            // Get project with checklist
            const project = await projectRepo.findOne({
                where: { id: projectId },
                select: ["id", "checklist"]
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            return res.status(200).json({
                success: true,
                checklist: project.checklist || []
            });

        } catch (error) {
            console.error("Error fetching project checklist:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while fetching project checklist"
            });
        }
    };

    // PUT /project/:projectId/checklist
    public updateProjectChecklist = async (
        req: Request<{ projectId: string }, {}, UpdateProjectChecklistRequest>,
        res: Response<UpdateProjectChecklistResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId } = req.params;
            const { checklist } = req.body;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required"
                });
            }

            if (!Array.isArray(checklist)) {
                return res.status(400).json({
                    success: false,
                    message: "Checklist must be an array"
                });
            }

            // Validate each checklist item
            for (const item of checklist) {
                if (!item.title?.trim()) {
                    return res.status(400).json({
                        success: false,
                        message: "Checklist item title is required"
                    });
                }

                if (typeof item.completed !== 'boolean') {
                    return res.status(400).json({
                        success: false,
                        message: "Checklist item completed status must be a boolean"
                    });
                }

                // Validate description if provided
                if (item.description !== undefined && item.description !== null) {
                    if (typeof item.description !== 'string') {
                        return res.status(400).json({
                            success: false,
                            message: "Checklist item description must be a string"
                        });
                    }
                }

                // Generate ID if not provided
                if (!item.id) {
                    item.id = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                }
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

            // Update the checklist
            project.checklist = checklist;
            project.updatedAt = new Date();

            await projectRepo.save(project);
            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Checklist updated successfully",
                checklist: project.checklist
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error updating project checklist:", error);

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while updating project checklist"
            });
        } finally {
            await queryRunner.release();
        }
    };

    // GET /project/:projectId/equipments
    public getProjectEquipments = async (
        req: Request<{ projectId: string }, {}, {}>,
        res: Response<GetProjectEquipmentsResponse>
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

            // Get project with equipments
            const project = await projectRepo.findOne({
                where: { id: projectId },
                select: ["id", "equipments"]
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            return res.status(200).json({
                success: true,
                equipments: project.equipments || []
            });

        } catch (error) {
            console.error("Error fetching project equipments:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while fetching project equipments"
            });
        }
    };

    // PUT /project/:projectId/equipments
    public updateProjectEquipments = async (
        req: Request<{ projectId: string }, {}, UpdateProjectEquipmentsRequest>,
        res: Response<UpdateProjectEquipmentsResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId } = req.params;
            const { equipments } = req.body;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required"
                });
            }

            if (!Array.isArray(equipments)) {
                return res.status(400).json({
                    success: false,
                    message: "Equipments must be an array"
                });
            }

            // Validate each equipment section
            for (const section of equipments) {
                if (!section.id?.trim()) {
                    return res.status(400).json({
                        success: false,
                        message: "Equipment section ID is required"
                    });
                }

                if (!section.title?.trim()) {
                    return res.status(400).json({
                        success: false,
                        message: "Equipment section title is required"
                    });
                }

                if (!['text', 'list', 'nested', 'item', 'checklist'].includes(section.type)) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid equipment section type"
                    });
                }

                if (section.order === undefined || section.order === null) {
                    return res.status(400).json({
                        success: false,
                        message: "Equipment section order is required"
                    });
                }

                if (typeof section.order !== 'number' || section.order < 0) {
                    return res.status(400).json({
                        success: false,
                        message: "Equipment section order must be a non-negative number"
                    });
                }

                // Validate content based on type
                if (section.type === 'text' && typeof section.content !== 'string') {
                    return res.status(400).json({
                        success: false,
                        message: "Text type equipment section must have string content"
                    });
                }

                if (section.type === 'list' && !Array.isArray(section.content)) {
                    return res.status(400).json({
                        success: false,
                        message: "List type equipment section must have array content"
                    });
                }
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

            // Update the equipments
            project.equipments = equipments;
            project.updatedAt = new Date();

            await projectRepo.save(project);
            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Equipments updated successfully",
                equipments: project.equipments
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error updating project equipments:", error);

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while updating project equipments"
            });
        } finally {
            await queryRunner.release();
        }
    };

    // GET /project/:projectId/assignments
    public getProjectAssignments = async (
        req: Request<{ projectId: string }, {}, {}>,
        res: Response<GetProjectAssignmentsResponse>
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

            const assignmentRepo = AppDataSource.getRepository(ProjectAssignment);

            // Get assignments with member and role relations
            const assignments = await assignmentRepo.find({
                where: { project: { id: projectId } },
                relations: ["member", "role"],
                select: {
                    id: true,
                    instructions: true,
                    member: {
                        id: true,
                        name: true,
                        email: true,
                        profilePhoto: true,
                        ringColor: true
                    },
                    role: {
                        id: true,
                        name: true
                    }
                }
            });

            // Transform the response
            const assignmentsResponse: AssignmentResponse[] = assignments.map(assignment => ({
                id: assignment.id,
                instructions: assignment.instructions || undefined,
                member: {
                    id: assignment.member.id,
                    name: assignment.member.name,
                    email: assignment.member.email,
                    profilePhoto: assignment.member.profilePhoto || undefined,
                    ringColor: assignment.member.ringColor || undefined,
                },
                role: {
                    id: assignment.role.id,
                    name: assignment.role.name
                }
            }));

            return res.status(200).json({
                success: true,
                assignments: assignmentsResponse
            });

        } catch (error) {
            console.error("Error fetching project assignments:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while fetching project assignments"
            });
        }
    };

    // PUT /project/assignment/:assignmentId/instructions
    public updateAssignmentInstructions = async (
        req: Request<{ assignmentId: string }, {}, UpdateAssignmentInstructionsRequest>,
        res: Response<UpdateAssignmentInstructionsResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { assignmentId } = req.params;
            const { instructions } = req.body;

            // Validation
            if (!assignmentId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Assignment ID is required"
                });
            }

            // Instructions can be empty string to clear them
            if (instructions === undefined) {
                return res.status(400).json({
                    success: false,
                    message: "Instructions are required"
                });
            }

            const assignmentRepo = queryRunner.manager.getRepository(ProjectAssignment);

            // Verify assignment exists with relations
            const assignment = await assignmentRepo.findOne({
                where: { id: assignmentId },
                relations: ["member", "role"]
            });

            if (!assignment) {
                return res.status(404).json({
                    success: false,
                    message: "Assignment not found"
                });
            }

            // Update the instructions
            assignment.instructions = instructions.trim() || null;
            assignment.updatedAt = new Date();

            await assignmentRepo.save(assignment);
            await queryRunner.commitTransaction();

            // Prepare response
            const assignmentResponse: AssignmentResponse = {
                id: assignment.id,
                instructions: assignment.instructions || undefined,
                member: {
                    id: assignment.member.id,
                    name: assignment.member.name,
                    email: assignment.member.email,
                    profilePhoto: assignment.member.profilePhoto || undefined,
                    ringColor: assignment.member.ringColor || undefined,
                },
                role: {
                    id: assignment.role.id,
                    name: assignment.role.name
                }
            };

            return res.status(200).json({
                success: true,
                message: "Instructions updated successfully",
                assignment: assignmentResponse
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error updating assignment instructions:", error);

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while updating assignment instructions"
            });
        } finally {
            await queryRunner.release();
        }
    };
    public getProjectDocuments = async (
        req: Request<{ projectId: string }, {}, {}>,
        res: Response<{ success: boolean; message?: string; documents?: { title: string; filename: string }[] }>
    ) => {
        try {
            const { projectId } = req.params;

            if (!projectId?.trim()) {
                return res.status(400).json({ success: false, message: "Project ID is required" });
            }

            const projectRepo = AppDataSource.getRepository(Project);
            const project = await projectRepo.findOne({
                where: { id: projectId },
                select: ["id", "documents"]
            });

            if (!project) {
                return res.status(404).json({ success: false, message: "Project not found" });
            }

            return res.status(200).json({
                success: true,
                documents: project.documents || []
            });
        } catch (error) {
            console.error("Error fetching project documents:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while fetching project documents"
            });
        }
    };
    public updateProjectDocuments = async (
        req: Request<{ projectId: string }, {}, { documents: { title: string; filename: string }[] }>,
        res: Response<{ success: boolean; message?: string; documents?: { title: string; filename: string }[] }>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId } = req.params;
            const { documents } = req.body;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({ success: false, message: "Project ID is required" });
            }

            if (!Array.isArray(documents)) {
                return res.status(400).json({ success: false, message: "Documents must be an array" });
            }

            // Validate each document
            for (const doc of documents) {
                if (!doc.title || typeof doc.title !== "string" || !doc.title.trim()) {
                    return res.status(400).json({ success: false, message: "Each document must have a title" });
                }
                if (!doc.filename || typeof doc.filename !== "string" || !doc.filename.trim()) {
                    return res.status(400).json({ success: false, message: "Each document must have a filename (S3 key or URL)" });
                }
            }

            const projectRepo = queryRunner.manager.getRepository(Project);

            const project = await projectRepo.findOne({ where: { id: projectId } });

            if (!project) {
                return res.status(404).json({ success: false, message: "Project not found" });
            }

            // replace documents array
            project.documents = documents;
            project.updatedAt = new Date();

            await projectRepo.save(project);
            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Documents updated successfully",
                documents: project.documents
            });
        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error updating project documents:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while updating project documents"
            });
        } finally {
            await queryRunner.release();
        }
    };
    public uploadProjectDocument = async (
        req: Request<{ projectId: string }, {}, {}>,
        res: Response<{ success: boolean; message?: string; document?: { title: string; filename: string } }>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId } = req.params;

            if (!projectId?.trim()) {
                return res.status(400).json({ success: false, message: "Project ID is required" });
            }

            // multer should have put file in req.file
            const file = (req as any).file as Express.Multer.File & { s3Key?: string; s3Url?: string };
            const titleFromBody = (req as any).body?.title;

            if (!file) {
                return res.status(400).json({ success: false, message: "File is required" });
            }

            const bucketName = process.env.AWS_S3_BUCKET_NAME;
            if (!bucketName) {
                return res.status(500).json({ success: false, message: "S3 bucket not configured" });
            }

            // Generate key and upload (using your uploadToS3 helper)
            const key = generateFileKey(file.originalname, "documents");
            const uploadResult = await uploadToS3({
                bucketName,
                key,
                body: file.buffer,
                contentType: file.mimetype,
                metadata: {
                    originalName: file.originalname,
                    uploadedAt: new Date().toISOString(),
                },
            });

            if (!uploadResult.success) {
                await queryRunner.rollbackTransaction();
                return res.status(500).json({ success: false, message: "Failed to upload file to S3", });
            }

            const projectRepo = queryRunner.manager.getRepository(Project);
            const project = await projectRepo.findOne({ where: { id: projectId } });

            if (!project) {
                return res.status(404).json({ success: false, message: "Project not found" });
            }

            const newDoc = {
                title: titleFromBody && typeof titleFromBody === "string" && titleFromBody.trim() ? titleFromBody.trim() : file.originalname,
                filename: uploadResult.key!, // store S3 key (or save URL if you prefer)
            };

            const currentDocs = Array.isArray(project.documents) ? project.documents : [];
            project.documents = [...currentDocs, newDoc];
            project.updatedAt = new Date();

            await projectRepo.save(project);
            await queryRunner.commitTransaction();

            return res.status(201).json({
                success: true,
                message: "Document uploaded and added to project",
                document: newDoc
            });
        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error uploading project document:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while uploading project document"
            });
        } finally {
            await queryRunner.release();
        }
    };
    public deleteProjectDocument = async (
        req: Request<{ projectId: string; filename: string }, {}, {}>,
        res: Response<{ success: boolean; message?: string }>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId, filename } = req.params;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({ success: false, message: "Project ID is required" });
            }

            if (!filename?.trim()) {
                return res.status(400).json({ success: false, message: "Filename is required" });
            }

            const projectRepo = queryRunner.manager.getRepository(Project);
            const project = await projectRepo.findOne({ where: { id: projectId } });

            if (!project) {
                return res.status(404).json({ success: false, message: "Project not found" });
            }

            const currentDocs = Array.isArray(project.documents) ? project.documents : [];

            // Find the document to delete
            const documentIndex = currentDocs.findIndex(doc => doc.filename === filename);

            if (documentIndex === -1) {
                return res.status(404).json({ success: false, message: "Document not found" });
            }

            // Remove the document from the array
            const updatedDocuments = currentDocs.filter(doc => doc.filename !== filename);
            project.documents = updatedDocuments;
            project.updatedAt = new Date();

            await projectRepo.save(project);
            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Document deleted successfully"
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error deleting project document:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while deleting project document"
            });
        } finally {
            await queryRunner.release();
        }
    };

    // DELETE /project/:projectId/documents (delete multiple documents)
    public deleteProjectDocuments = async (
        req: Request<{ projectId: string }, {}, { filenames: string[] }>,
        res: Response<{ success: boolean; message?: string }>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId } = req.params;
            const { filenames } = req.body;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({ success: false, message: "Project ID is required" });
            }

            if (!Array.isArray(filenames) || filenames.length === 0) {
                return res.status(400).json({ success: false, message: "Filenames array is required" });
            }

            const projectRepo = queryRunner.manager.getRepository(Project);
            const project = await projectRepo.findOne({ where: { id: projectId } });

            if (!project) {
                return res.status(404).json({ success: false, message: "Project not found" });
            }

            const currentDocs = Array.isArray(project.documents) ? project.documents : [];

            // Remove the specified documents from the array
            const updatedDocuments = currentDocs.filter(doc => !filenames.includes(doc.filename));

            // Check if any documents were actually removed
            if (updatedDocuments.length === currentDocs.length) {
                return res.status(404).json({ success: false, message: "No matching documents found to delete" });
            }

            project.documents = updatedDocuments;
            project.updatedAt = new Date();

            await projectRepo.save(project);
            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: `${currentDocs.length - updatedDocuments.length} document(s) deleted successfully`
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error deleting project documents:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while deleting project documents"
            });
        } finally {
            await queryRunner.release();
        }
    };
    public getProjectReminders = async (
        req: Request<{ projectId: string }, {}, {}>,
        res: Response<GetProjectRemindersResponse>
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
                select: ["id", "reminders"]
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            return res.status(200).json({
                success: true,
                reminders: project.reminders || { weekBefore: true, dayBefore: true }
            });

        } catch (error) {
            console.error("Error fetching project reminders:", error);
            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while fetching project reminders"
            });
        }
    };

    public updateProjectReminders = async (
        req: Request<{ projectId: string }, {}, UpdateProjectRemindersRequest>,
        res: Response<UpdateProjectRemindersResponse>
    ) => {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            const { projectId } = req.params;
            const { reminders } = req.body;

            // Validation
            if (!projectId?.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Project ID is required"
                });
            }

            if (!reminders || typeof reminders !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: "Reminders object is required"
                });
            }

            // Validate reminders structure
            if (typeof reminders.weekBefore !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    message: "weekBefore must be a boolean"
                });
            }

            if (typeof reminders.dayBefore !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    message: "dayBefore must be a boolean"
                });
            }

            const projectRepo = queryRunner.manager.getRepository(Project);

            const project = await projectRepo.findOne({
                where: { id: projectId }
            });

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message: "Project not found"
                });
            }

            project.reminders = reminders;
            project.updatedAt = new Date();

            await projectRepo.save(project);
            await queryRunner.commitTransaction();

            return res.status(200).json({
                success: true,
                message: "Reminders updated successfully",
                reminders: project.reminders
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            console.error("Error updating project reminders:", error);

            return res.status(500).json({
                success: false,
                message: "An internal server error occurred while updating project reminders"
            });
        } finally {
            await queryRunner.release();
        }
    };
}

export default new AdditionalTabsController();