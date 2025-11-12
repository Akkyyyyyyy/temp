import { Request, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { Project } from "../../entity/Project";
import { deleteFromS3, uploadToS3 } from "../../utils/s3upload";
import {
  ICreateFolderResponse,
  IDeleteFolderResponse,
  IDeleteImageResponse,
  IGetMoodBoardResponse,
  IUploadImagesResponse
} from "./moodBoard.types";

class MoodBoardController {
  /**
   * GET /project/:projectId/moodboard
   * Get all moodBoard data folder-wise
   */
  public getMoodBoard = async (
    req: Request<{ projectId: string }, {}, {}>,
    res: Response<IGetMoodBoardResponse>
  ) => {
    try {
      const { projectId } = req.params;

      if (!projectId?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Project ID is required",
        });
      }

      const projectRepo = AppDataSource.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId },
        select: ["id", "moodBoard"],
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found",
        });
      }

      // Ensure proper structure
      const moodBoard = project.moodBoard || { folders: {}, uploads: {} };
      if (!moodBoard.folders) moodBoard.folders = {};
      if (!moodBoard.uploads) moodBoard.uploads = {};

      return res.status(200).json({
        success: true,
        moodBoard,
      });
    } catch (error) {
      console.error("Error fetching moodBoard:", error);
      return res.status(500).json({
        success: false,
        message: "An internal server error occurred while fetching moodBoard",
      });
    }
  };

  /**
   * POST /project/:projectId/moodboard/folder
   * Create a new folder in moodBoard
   */
  public createFolder = async (
    req: Request<{ projectId: string }, {}, { folderName: string; parentId?: string }>,
    res: Response<ICreateFolderResponse>
  ) => {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { projectId } = req.params;
      const { folderName, parentId } = req.body;

      if (!projectId?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Project ID is required",
        });
      }

      if (!folderName?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Folder name is required",
        });
      }

      // Validate folder name (no special characters except spaces, hyphens, underscores)
      const validFolderNameRegex = /^[a-zA-Z0-9\s\-_]+$/;
      if (!validFolderNameRegex.test(folderName.trim())) {
        return res.status(400).json({
          success: false,
          message: "Folder name can only contain letters, numbers, spaces, hyphens, and underscores",
        });
      }

      const projectRepo = queryRunner.manager.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId },
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found",
        });
      }

      // Ensure proper structure
      const moodBoard = project.moodBoard || { folders: {}, uploads: {} };
      if (!moodBoard.folders) moodBoard.folders = {};
      if (!moodBoard.uploads) moodBoard.uploads = {};

      const trimmedFolderName = folderName.trim();

      // Check if folder with same name already exists (case-insensitive)
      const existingFolder = Object.values(moodBoard.folders).find(
        (folder: any) => folder.name.toLowerCase() === trimmedFolderName.toLowerCase()
      );

      if (existingFolder) {
        return res.status(409).json({
          success: false,
          message: "Folder with this name already exists (names are case-insensitive)",
        });
      }

      // If parentId is provided, verify it exists
      if (parentId && !moodBoard.folders[parentId]) {
        return res.status(404).json({
          success: false,
          message: "Parent folder not found",
        });
      }

      // Generate unique folder ID
      const folderId = `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create new folder metadata
      const newFolder = {
        name: trimmedFolderName,
        parentId: parentId || null,
        createdAt: new Date().toISOString(),
      };

      moodBoard.folders[folderId] = newFolder;
      project.moodBoard = moodBoard;

      await projectRepo.save(project);
      await queryRunner.commitTransaction();

      return res.status(201).json({
        success: true,
        message: "Folder created successfully",
        folderId,
        folder: newFolder,
      });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error("Error creating folder:", error);
      return res.status(500).json({
        success: false,
        message: "An internal server error occurred while creating folder",
      });
    } finally {
      await queryRunner.release();
    }
  };

  /**
   * POST /project/:projectId/moodboard/upload
   * Upload images to a specific folder (bulk upload)
   */
  public uploadImages = async (
    req: Request<{ projectId: string }, {}, { folderId: string }>,
    res: Response<IUploadImagesResponse>
  ) => {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { projectId } = req.params;
      const { folderId } = req.body;
      const files = (req as any).files as Express.Multer.File[];

      if (!projectId?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Project ID is required",
        });
      }

      if (!folderId?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Folder ID is required",
        });
      }

      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No files uploaded",
        });
      }

      const bucketName = process.env.AWS_S3_BUCKET_NAME;
      if (!bucketName) {
        return res.status(500).json({
          success: false,
          message: "S3 bucket not configured",
        });
      }

      const projectRepo = queryRunner.manager.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId },
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found",
        });
      }

      // Ensure proper structure
      const moodBoard = project.moodBoard || { folders: {}, uploads: {} };
      if (!moodBoard.folders) moodBoard.folders = {};
      if (!moodBoard.uploads) moodBoard.uploads = {};

      // Check if folder exists
      if (!moodBoard.folders[folderId]) {
        return res.status(404).json({
          success: false,
          message: "Folder not found. Please create the folder first.",
        });
      }

      const folderName = moodBoard.folders[folderId].name;
      const uploadedUrls: string[] = [];
      const failedUploads: string[] = [];

      // Upload all files to S3
      for (const file of files) {
        try {
          // Generate unique file key with timestamp + random string to prevent overwrites
          const timestamp = Date.now();
          const randomStr = Math.random().toString(36).substring(2, 11);
          const extension = file.originalname.split('.').pop();
          const baseName = file.originalname
            .split('.')
            .slice(0, -1)
            .join('.')
            .replace(/[^a-zA-Z0-9]/g, '_');
          const uniqueFileName = `${baseName}_${timestamp}_${randomStr}.${extension}`;
          const fileKey = `moodboard/${uniqueFileName}`;
          
          const uploadResult = await uploadToS3({
            bucketName,
            key: fileKey,
            body: file.buffer,
            contentType: file.mimetype,
            metadata: {
              originalName: file.originalname,
              uploadedAt: new Date().toISOString(),
              projectId,
              folderId,
              folderName,
            },
          });

          if (uploadResult.success && uploadResult.url) {
            uploadedUrls.push(uploadResult.url);
          } else {
            failedUploads.push(file.originalname);
            console.error(`Failed to upload ${file.originalname}:`, uploadResult.error);
          }
        } catch (uploadError) {
          failedUploads.push(file.originalname);
          console.error(`Error uploading ${file.originalname}:`, uploadError);
        }
      }

      // If no files were uploaded successfully
      if (uploadedUrls.length === 0) {
        await queryRunner.rollbackTransaction();
        return res.status(500).json({
          success: false,
          message: "All file uploads failed",
          failedUploads,
        });
      }

      // Add uploaded URLs to the folder's uploads
      if (!moodBoard.uploads[folderId]) {
        moodBoard.uploads[folderId] = [];
      }
      moodBoard.uploads[folderId] = [
        ...moodBoard.uploads[folderId],
        ...uploadedUrls,
      ];
      project.moodBoard = moodBoard;

      await projectRepo.save(project);
      await queryRunner.commitTransaction();

      const responseMessage =
        failedUploads.length > 0
          ? `${uploadedUrls.length} file(s) uploaded successfully, ${failedUploads.length} failed`
          : `${uploadedUrls.length} file(s) uploaded successfully`;

      return res.status(200).json({
        success: true,
        message: responseMessage,
        uploadedUrls,
        failedUploads: failedUploads.length > 0 ? failedUploads : undefined,
      });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error("Error uploading images:", error);
      return res.status(500).json({
        success: false,
        message: "An internal server error occurred while uploading images",
      });
    } finally {
      await queryRunner.release();
    }
  };

  /**
   * DELETE /project/:projectId/moodboard/image
   * Delete a specific image from folder and S3
   */
  public deleteImage = async (
    req: Request<{ projectId: string }, {}, { folderId: string; imageUrl: string }>,
    res: Response<IDeleteImageResponse>
  ) => {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { projectId } = req.params;
      const { folderId, imageUrl } = req.body;

      if (!projectId?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Project ID is required",
        });
      }

      if (!folderId?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Folder ID is required",
        });
      }

      if (!imageUrl?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Image URL is required",
        });
      }

      const bucketName = process.env.AWS_S3_BUCKET_NAME;
      if (!bucketName) {
        return res.status(500).json({
          success: false,
          message: "S3 bucket not configured",
        });
      }

      const projectRepo = queryRunner.manager.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId },
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found",
        });
      }

      // Ensure proper structure
      const moodBoard = project.moodBoard || { folders: {}, uploads: {} };
      if (!moodBoard.folders) moodBoard.folders = {};
      if (!moodBoard.uploads) moodBoard.uploads = {};

      // Check if folder exists
      if (!moodBoard.folders[folderId]) {
        return res.status(404).json({
          success: false,
          message: "Folder not found",
        });
      }

      // Check if uploads exist for this folder
      if (!moodBoard.uploads[folderId] || moodBoard.uploads[folderId].length === 0) {
        return res.status(404).json({
          success: false,
          message: "No images found in this folder",
        });
      }

      // Check if image exists in folder
      const imageIndex = moodBoard.uploads[folderId].indexOf(imageUrl.trim());
      if (imageIndex === -1) {
        return res.status(404).json({
          success: false,
          message: "Image not found in folder",
        });
      }

      // Extract S3 key from URL
      // URL format: https://cloudfront-domain.com/moodboard/image_timestamp_random.jpg
      // We need to extract: moodboard/image_timestamp_random.jpg
      let s3Key: string;
      try {
        const url = new URL(imageUrl.trim());
        // Remove leading slash from pathname to get the S3 key
        s3Key = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
      } catch (error) {
        // Fallback if URL parsing fails: split by '/' and skip protocol + domain
        const urlParts = imageUrl.split('/');
        s3Key = urlParts.slice(3).join('/');
      }

      // Delete from S3
      console.log(`Attempting to delete from S3 - Bucket: ${bucketName}, Key: ${s3Key}`);
      const deleteResult = await deleteFromS3(bucketName, s3Key);

      if (!deleteResult.success) {
        console.error(`Failed to delete from S3: ${deleteResult.error}`);
        // Continue with database deletion even if S3 deletion fails
      } else {
        console.log(`Successfully deleted from S3: ${s3Key}`);
      }

      // Remove from database
      moodBoard.uploads[folderId].splice(imageIndex, 1);
      project.moodBoard = moodBoard;

      await projectRepo.save(project);
      await queryRunner.commitTransaction();

      return res.status(200).json({
        success: true,
        message: "Image deleted successfully",
      });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error("Error deleting image:", error);
      return res.status(500).json({
        success: false,
        message: "An internal server error occurred while deleting image",
      });
    } finally {
      await queryRunner.release();
    }
  };

  /**
   * DELETE /project/:projectId/moodboard/folder
   * Delete a folder and all its images from both database and S3
   */
  public deleteFolder = async (
    req: Request<{ projectId: string }, {}, { folderId: string }>,
    res: Response<IDeleteFolderResponse>
  ) => {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { projectId } = req.params;
      const { folderId } = req.body;

      if (!projectId?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Project ID is required",
        });
      }

      if (!folderId?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Folder ID is required",
        });
      }

      const bucketName = process.env.AWS_S3_BUCKET_NAME;
      if (!bucketName) {
        return res.status(500).json({
          success: false,
          message: "S3 bucket not configured",
        });
      }

      const projectRepo = queryRunner.manager.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId },
      });

      if (!project) {
        return res.status(404).json({
          success: false,
          message: "Project not found",
        });
      }

      // Ensure proper structure
      const moodBoard = project.moodBoard || { folders: {}, uploads: {} };
      if (!moodBoard.folders) moodBoard.folders = {};
      if (!moodBoard.uploads) moodBoard.uploads = {};

      // Check if folder exists
      if (!moodBoard.folders[folderId]) {
        return res.status(404).json({
          success: false,
          message: "Folder not found",
        });
      }

      const folderName = moodBoard.folders[folderId].name;
      const imageUrls = moodBoard.uploads[folderId] || [];
      const failedDeletions: string[] = [];
      let deletedImagesCount = 0;

      // Delete all images from S3
      if (imageUrls.length > 0) {
        console.log(`Deleting ${imageUrls.length} images from folder "${folderName}" (${folderId})`);

        for (const imageUrl of imageUrls) {
          try {
            // Extract S3 key from URL
            let s3Key: string;
            try {
              const url = new URL(imageUrl.trim());
              s3Key = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
            } catch (error) {
              const urlParts = imageUrl.split('/');
              s3Key = urlParts.slice(3).join('/');
            }

            console.log(`Deleting image from S3 - Key: ${s3Key}`);
            const deleteResult = await deleteFromS3(bucketName, s3Key);

            if (deleteResult.success) {
              deletedImagesCount++;
              console.log(`Successfully deleted: ${s3Key}`);
            } else {
              failedDeletions.push(imageUrl);
              console.error(`Failed to delete ${s3Key}: ${deleteResult.error}`);
            }
          } catch (error) {
            failedDeletions.push(imageUrl);
            console.error(`Error deleting image ${imageUrl}:`, error);
          }
        }
      }

      // Remove folder from folders object
      delete moodBoard.folders[folderId];

      // Remove folder uploads from uploads object
      delete moodBoard.uploads[folderId];

      project.moodBoard = moodBoard;

      await projectRepo.save(project);
      await queryRunner.commitTransaction();

      const message = failedDeletions.length > 0
        ? `Folder deleted. ${deletedImagesCount} image(s) deleted, ${failedDeletions.length} failed`
        : imageUrls.length > 0
        ? `Folder and ${deletedImagesCount} image(s) deleted successfully`
        : "Empty folder deleted successfully";

      return res.status(200).json({
        success: true,
        message,
        deletedImagesCount,
        failedDeletions: failedDeletions.length > 0 ? failedDeletions : undefined,
      });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error("Error deleting folder:", error);
      return res.status(500).json({
        success: false,
        message: "An internal server error occurred while deleting folder",
      });
    } finally {
      await queryRunner.release();
    }
  };
}

export default new MoodBoardController();

