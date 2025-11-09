import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedUrlV3 } from '@aws-sdk/s3-request-presigner';
import multer from 'multer';
import { Request } from 'express';

// Extend Multer File interface
interface ExtendedFile extends Express.Multer.File {
  s3Url?: string;
  s3Key?: string;
}

// ✅ Create S3 Client (AWS SDK v3 uses modular imports)
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Multer configuration for memory storage with file validation
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'video/mp4',
      'video/mpeg',
      'video/quicktime'
    ];
    if (allowedMimes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Only images and documents are allowed.'));
  },
});

// Multer configuration for form data without file restrictions
export const formUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
    fieldSize: 10 * 1024 * 1024,
  },
});

// Multer configuration for text-only form data (no files)
export const textUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fieldSize: 10 * 1024 * 1024 },
});

// Interface for upload parameters
export interface UploadParams {
  bucketName: string;
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: { [key: string]: string };
}

// Interface for upload result
export interface UploadResult {
  success: boolean;
  url?: string;
  key?: string;
  error?: string;
}

/**
 * ✅ Upload file to S3 using AWS SDK v3
 */
export const uploadToS3 = async (params: UploadParams): Promise<UploadResult> => {
  try {
    const command = new PutObjectCommand({
      Bucket: params.bucketName,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      Metadata: params.metadata || {},
      // ACL: 'public-read', // optional
    });

    await s3Client.send(command);

    const cloudFrontUrl = `${process.env.VITE_S3_BASE_URL}/${params.key}`;

    return { success: true, url: cloudFrontUrl, key: params.key };
  } catch (error) {
    console.error('S3 upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

/**
 * ✅ Delete file from S3
 */
export const deleteFromS3 = async (
  bucketName: string,
  key: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    await s3Client.send(command);
    return { success: true };
  } catch (error) {
    console.error('S3 delete error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

/**
 * ✅ Generate a unique file key
 */
export const generateFileKey = (originalName: string, folder: string = 'images'): string => {
  const timestamp = Date.now();
  const extension = originalName.split('.').pop();
  const baseName = originalName
    .split('.')
    .slice(0, -1)
    .join('.')
    .replace(/[^a-zA-Z0-9]/g, '_');
  return `${folder}/${baseName}_${timestamp}.${extension}`;
};

/**
 * ✅ Express Middleware for upload and S3 push
 */
export const createUploadMiddleware = (fieldName: string, folder?: string) => {
  return async (req: Request, res: any, next: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const bucketName = process.env.AWS_S3_BUCKET_NAME;
      if (!bucketName) {
        return res.status(500).json({ error: 'S3 bucket not configured' });
      }

      const fileKey = generateFileKey(req.file.originalname, folder);
      const uploadResult = await uploadToS3({
        bucketName,
        key: fileKey,
        body: req.file.buffer,
        contentType: req.file.mimetype,
        metadata: {
          originalName: req.file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      });

      if (uploadResult.success) {
        (req.file as ExtendedFile).s3Url = uploadResult.url;
        (req.file as ExtendedFile).s3Key = uploadResult.key;
        next();
      } else {
        res.status(500).json({ error: uploadResult.error });
      }
    } catch (error) {
      console.error('Upload middleware error:', error);
      res.status(500).json({ error: 'File upload failed' });
    }
  };
};

/**
 * ✅ Generate signed URL for private file access
 */
export const getSignedUrl = async (
  bucketName: string,
  key: string,
  expiresIn: number = 3600
): Promise<string> => {
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const signedUrl = await getSignedUrlV3(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }
};

export default {
  upload,
  uploadToS3,
  deleteFromS3,
  generateFileKey,
  createUploadMiddleware,
  getSignedUrl,
};
