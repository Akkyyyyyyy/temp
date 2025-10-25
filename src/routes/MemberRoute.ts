import express from "express";
import MemberController from "../controller/member/member.controller";
import authMiddleware from "../middleware/jwt";
import { createUploadMiddleware, formUpload, upload } from "../utils/s3upload";

const memberRouter = express.Router();

memberRouter.post("/add", authMiddleware, MemberController.createMember);
memberRouter.post("/by-company", authMiddleware, MemberController.getMembersByCompany);
memberRouter.post('/available', authMiddleware, MemberController.getAvailableMembers);
memberRouter.put("/update/:id", authMiddleware, MemberController.updateMember);
memberRouter.put("/update/:id", authMiddleware, formUpload.single('photo'), MemberController.updateMember);
memberRouter.post("/upload-photo", authMiddleware, upload.single('photo'), createUploadMiddleware('photo', 'images'), MemberController.uploadProfilePhoto);
memberRouter.delete('/remove-photo/:id',authMiddleware, MemberController.removeProfilePhoto);
memberRouter.post("/login", MemberController.memberLogin);
memberRouter.delete("/delete/:id", MemberController.deleteMember);
memberRouter.patch('/:id/ring-color',authMiddleware,MemberController.updateRingColor);

export default memberRouter;