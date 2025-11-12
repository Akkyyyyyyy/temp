// MoodBoard API Types

export interface IFolderMetadata {
  name: string;
  parentId?: string | null;
  createdAt: string;
}

export interface IGetMoodBoardRequest {
  projectId: string;
}

export interface IGetMoodBoardResponse {
  success: boolean;
  message?: string;
  moodBoard?: {
    folders: {
      [folderId: string]: IFolderMetadata;
    };
    uploads: {
      [folderId: string]: string[];
    };
  };
}

export interface ICreateFolderRequest {
  projectId: string;
  folderName: string;
}

export interface ICreateFolderResponse {
  success: boolean;
  message: string;
  folderId?: string;
  folder?: IFolderMetadata;
}

export interface IUploadImagesRequest {
  projectId: string;
  folderId: string;
}

export interface IUploadImagesResponse {
  success: boolean;
  message: string;
  uploadedUrls?: string[];
  failedUploads?: string[];
}

export interface IDeleteImageRequest {
  projectId: string;
  folderId: string;
  imageUrl: string;
}

export interface IDeleteImageResponse {
  success: boolean;
  message: string;
}

export interface IDeleteFolderRequest {
  projectId: string;
  folderId: string;
}

export interface IDeleteFolderResponse {
  success: boolean;
  message: string;
  deletedImagesCount?: number;
  failedDeletions?: string[];
}

