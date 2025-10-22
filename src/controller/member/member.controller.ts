import { Request, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { Member, MemberRole } from "../../entity/Member";
import { Company } from "../../entity/Company";
import { IAvailableMemberResponse, IConflict, ICreateMemberRequest, ICreateMemberResponse, IForgotPasswordRequest, IGetAvailableMembersRequest, IGetMembersByCompanyRequest, IGetMembersByCompanyResponse, IMemberResponse, IPasswordResetToken, IResetPasswordRequest, IUpdateMemberRequest, IUpdateMemberResponse, IUpdateRingColorRequest, IUpdateRingColorResponse, IVerifiedResetToken, IVerifyOTPRequest } from "./types";
import bcrypt from "bcryptjs";
import { sendNewMemberEmail, transporter } from "../../utils/mailer";
import jwt from "jsonwebtoken";
import { deleteFromS3, uploadToS3 } from "../../utils/s3upload";



const memberRepo = AppDataSource.getRepository(Member);
const companyRepo = AppDataSource.getRepository(Company);

class MemberController {
  private readonly JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
  private readonly PASSWORD_RESET_EXPIRY = '15m';
  public createMember = async (
    req: Request<{}, {}, ICreateMemberRequest>,
    res: Response<ICreateMemberResponse>
  ) => {
    try {
      const { name, email, role, companyId } = req.body;

      const roles: MemberRole[] = [
        "Project Manager",
        "Creative Director",
        "Lead Photographer",
        "Photographer",
        "Videographer",
        "Editor",
        "Assistant",
        "Other"
      ];

      if (!roles.includes(role as MemberRole)) {
        return res.status(400).json({ success: false, message: "Invalid role" });
      }

      const company = await AppDataSource.getRepository(Company).findOneBy({ id: companyId });
      if (!company) return res.status(404).json({ success: false, message: "Company not found" });

      // Check member count for the company
      const memberCount = await memberRepo.count({
        where: { company: { id: companyId } }
      });

      if (memberCount >= 20) {
        return res.status(400).json({
          success: false,
          message: "Member limit reached. Maximum 20 members per company."
        });
      }

      const existing = await memberRepo.findOneBy({ email });
      if (existing) return res.status(400).json({ success: false, message: "Email already exists" });

      const rawPassword = Math.floor(100000 + Math.random() * 900000).toString(); // e.g., "345678"
      const passwordHash = await bcrypt.hash(rawPassword, 10);
      const member = memberRepo.create({
        name,
        email,
        role,
        passwordHash,
        company: { id: companyId }, // store only FK
      });

      await memberRepo.save(member);
      // if (process.env.SMTP_EMAIL) {
      //   await sendNewMemberEmail(email, name, rawPassword);
      // }
      // TODO: generate invite token & send email

      return res.status(201).json({ success: true, message: "Member Created Successfully", member });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  };
  public getMembersByCompany = async (
    req: Request<{}, {}, IGetMembersByCompanyRequest>,
    res: Response<IGetMembersByCompanyResponse>
  ) => {
    try {
      const { companyId, month, year, week, viewType, memberId } = req.body;

      if (!companyId) {
        return res.status(400).json({
          success: false,
          message: "Company ID is required"
        });
      }

      if (!viewType || !['month', 'week'].includes(viewType)) {
        return res.status(400).json({
          success: false,
          message: "Valid viewType (month or week) is required"
        });
      }

      // Validate based on view type
      if (viewType === 'month') {
        if (!month || !year) {
          return res.status(400).json({
            success: false,
            message: "Month and year are required for month view"
          });
        }
      } else if (viewType === 'week') {
        if (!week || !year) {
          return res.status(400).json({
            success: false,
            message: "Week and year are required for week view"
          });
        }
      }

      const company = await companyRepo.findOneBy({ id: companyId });
      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found"
        });
      }

      // Calculate date ranges based on view type
      let startDate: string;
      let endDate: string;

      if (viewType === 'month') {
        // Month view logic
        startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        endDate = `${year}-${month.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;
      } else {
        // Week view logic
        const weekStart = this.getDateFromWeek(year, week);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6); // Add 6 days to get end of week

        startDate = this.formatDate(weekStart);
        endDate = this.formatDate(weekEnd);
      }

      // Build where condition based on whether memberId is provided
      const whereCondition: any = {
        company: { id: companyId }
      };

      // If memberId is provided, filter for that specific member
      if (memberId) {
        whereCondition.id = memberId;
      }

      const members = await memberRepo.find({
        where: whereCondition,
        relations: [
          "assignments",
          "assignments.project"
        ],
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          bio: true,
          profilePhoto: true,
          location: true,
          phone: true,
          skills: true,
          ringColor: true,
          assignments: {
            id: true,
            role: true,
            project: {
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
              logistics: true
            }
          }
        },
        order: {
          createdAt: "DESC"
        }
      });

      // If memberId was provided but no member found, return error
      if (memberId && members.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this company"
        });
      }

      // Format the response with proper type conversion and date filtering
      const membersResponse: IMemberResponse[] = members.map(member => {


        // Filter assignments to only include projects that fall within the requested date range
        const filteredAssignments = member.assignments?.filter(assignment => {
          const project = assignment.project;

          // If project has no dates, include it
          if (!project.startDate && !project.endDate) {
            return true;
          }

          // Parse string dates (yyyy-mm-dd format)
          const projectStartDate = project.startDate;
          const projectEndDate = project.endDate;

          // Check if project overlaps with the requested date range
          // Project overlaps if:
          // 1. Project starts in the date range OR
          // 2. Project ends in the date range OR  
          // 3. Project spans the entire date range (starts before and ends after)
          // 4. Project is ongoing during the date range

          const startsInRange = projectStartDate &&
            projectStartDate >= startDate &&
            projectStartDate <= endDate;

          const endsInRange = projectEndDate &&
            projectEndDate >= startDate &&
            projectEndDate <= endDate;

          const spansRange = projectStartDate && projectEndDate &&
            projectStartDate <= startDate &&
            projectEndDate >= endDate;

          const ongoingInRange = projectStartDate && !projectEndDate &&
            projectStartDate <= endDate;

          const startedBeforeAndEndsAfter = projectStartDate && projectEndDate &&
            projectStartDate <= endDate &&
            projectEndDate >= startDate;

          return startsInRange || endsInRange || spansRange || ongoingInRange || startedBeforeAndEndsAfter;
        }) || [];
        return {
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          phone: member.phone || '',
          location: member.location || '',
          bio: member.bio || '',
          profilePhoto: member.profilePhoto || '',
          ringColor: member.ringColor || '',
          skills: member.skills || [],
          companyId: companyId,
          projects: filteredAssignments.map(assignment => {
            return {
              id: assignment.project.id,
              name: assignment.project.name,
              startDate: assignment.project.startDate,
              endDate: assignment.project.endDate,
              color: assignment.project.color,
              assignedTo: member.name,
              startHour: assignment.project.startHour,
              endHour: assignment.project.endHour,
              location: assignment.project.location,
              description: assignment.project.description,
              client: assignment.project.client,
              newRole: assignment.role,
              brief: assignment.project.brief,
              logistics: assignment.project.logistics
            };
          })
        };
      });
      // Prepare response metadata based on view type
      const responseMetadata = viewType === 'month'
        ? { month, year }
        : { week, year };

      return res.status(200).json({
        success: true,
        message: memberId
          ? `Member details retrieved successfully for ${viewType} view`
          : `Members retrieved successfully for ${viewType} view`,
        members: membersResponse,
        totalCount: membersResponse.length,
        viewType,
        ...responseMetadata,
        dateRange: {
          startDate,
          endDate
        }
      });

    } catch (err) {
      console.error("Error fetching members:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while fetching members"
      });
    }
  };

  // Helper function to get date from week number
  private getDateFromWeek(year: number, week: number): Date {
    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const dayOfWeek = simple.getDay();
    const isoWeekStart = simple;

    if (dayOfWeek <= 4) {
      isoWeekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
      isoWeekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }

    return isoWeekStart;
  }

  // Helper function to format date as yyyy-mm-dd
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  public updateMember = async (
    req: Request<{ id: string }, {}, IUpdateMemberRequest>,
    res: Response<IUpdateMemberResponse>
  ) => {
    try {
      const { id: memberId } = req.params;
      const { name, email, role, phone, location, bio, skills, profilePhoto } = req.body;
      // const file = req.file;
      const companyId = res.locals.token?.companyId;
      const memberid = res.locals.token?.memberId;

      // Handle skills array from form-data
      let skillsArray: string[] = [];
      if (skills) {
        if (typeof skills === 'string') {
          try {
            skillsArray = JSON.parse(skills);
          } catch {
            skillsArray = (skills as string).split(',').map(skill => skill.trim()).filter(skill => skill);
          }
        } else if (Array.isArray(skills)) {
          skillsArray = skills as string[];
        }
      }




      // Update validation to include new fields
      if (
        name === undefined &&
        email === undefined &&
        role === undefined &&
        phone === undefined &&
        location === undefined &&
        bio === undefined &&
        skills === undefined &&
        profilePhoto === undefined
      ) {
        return res.status(400).json({
          success: false,
          message:
            "At least one field (name, email, role, phone, country, location, bio, skills, or profilePhoto) must be provided for update"
        });
      }


      // Phone number validation
      // if (phone) {
      //   const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
      //   if (!phoneRegex.test(phone)) {
      //     return res.status(400).json({
      //       success: false,
      //       message: "Invalid phone number format"
      //     });
      //   }
      // }

      if (role) {
        const validRoles: MemberRole[] = [
          "Project Manager",
          "Creative Director",
          "Lead Photographer",
          "Photographer",
          "Videographer",
          "Editor",
          "Assistant",
          "Other",
        ];

        if (!validRoles.includes(role as MemberRole)) {
          return res.status(400).json({
            success: false,
            message: "Invalid role"
          });
        }
      }

      const member = await memberRepo.findOne({
        where: { id: memberId },
        relations: ["company"]
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found"
        });
      }

      if (member.company.id !== companyId && !memberId) {
        return res.status(403).json({
          success: false,
          message: "You can only update members from your own company"
        });
      }

      // Handle profile photo upload if provided
      // if (file) {
      //   const bucketName = process.env.AWS_S3_BUCKET_NAME;

      //   if (bucketName) {
      //     // Generate filename: image_name + current_time + original extension
      //     const timestamp = Date.now();
      //     const extension = file.originalname.split('.').pop();
      //     const baseName = file.originalname.split('.').slice(0, -1).join('.').replace(/[^a-zA-Z0-9]/g, '_');
      //     const fileName = `${baseName}_${timestamp}.${extension}`;
      //     const fileKey = `images/${fileName}`;

      //     const uploadResult = await uploadToS3({
      //       bucketName,
      //       key: fileKey,
      //       body: file.buffer,
      //       contentType: file.mimetype, // Dynamic content type
      //       metadata: {
      //         originalName: file.originalname,
      //         memberId: memberId,
      //         uploadedAt: new Date().toISOString()
      //       }
      //     });

      //     if (uploadResult.success) {
      //       member.profilePhoto = fileKey; // Store just the path, not full URL
      //     }
      //   }
      // }

      // Update fields if provided
      if (name !== undefined) member.name = name;
      if (role !== undefined) member.role = role;
      if (phone !== undefined) member.phone = phone;
      if (location !== undefined) member.location = location;
      if (bio !== undefined) member.bio = bio;
      if (skills !== undefined) member.skills = skillsArray;
      if (profilePhoto !== undefined) member.profilePhoto = profilePhoto;

      const updatedMember = await memberRepo.save(member);

      return res.status(200).json({
        success: true,
        message: "Member updated successfully",
        member: updatedMember
      });

    } catch (err) {
      console.error("Error updating member:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while updating member"
      });
    }
  };

  public uploadProfilePhoto = async (req: Request, res: Response) => {
    try {
      const { memberId } = req.body;
      const file = (req as any).file;

      if (!file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded"
        });
      }

      const member = await memberRepo.findOneBy({ id: memberId });
      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found"
        });
      }

      if (file.s3Key) {

        member.profilePhoto = file.s3Key;

        const savedMember = await memberRepo.save(member);

        return res.status(200).json({
          success: true,
          message: "Profile photo uploaded successfully",
          profilePhotoPath: file.s3Key
        });
      } else {
        console.log('No s3Key found in file object');
        return res.status(500).json({
          success: false,
          message: "Failed to upload profile photo - no s3Key"
        });
      }

    } catch (error) {
      console.error("Error uploading profile photo:", error);
      return res.status(500).json({
        success: false,
        message: "Server error while uploading profile photo"
      });
    }
  };
  public removeProfilePhoto = async (
    req: Request<{ id: string }>,
    res: Response
  ) => {
    try {
      const { id: memberId } = req.params;
      const companyId = res.locals.token?.companyId;

      // Find the member
      const member = await memberRepo.findOne({
        where: { id: memberId },
        relations: ["company"]
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found"
        });
      }

      // Check if member belongs to the company
      if (member.company.id !== companyId) {
        return res.status(403).json({
          success: false,
          message: "You can only update members from your own company"
        });
      }

      // Check if member has a profile photo
      if (!member.profilePhoto) {
        return res.status(400).json({
          success: false,
          message: "Member does not have a profile photo to remove"
        });
      }

      const bucketName = process.env.AWS_S3_BUCKET_NAME;
      if (bucketName && member.profilePhoto) {
        try {
          const deleteResult = await deleteFromS3(bucketName, member.profilePhoto);

          if (!deleteResult.success) {
            console.error("Failed to delete file from S3:", deleteResult.error);
          }
        } catch (s3Error) {
          console.error("Error deleting file from S3:", s3Error);
        }
      }

      member.profilePhoto = null;
      const updatedMember = await memberRepo.save(member);

      return res.status(200).json({
        success: true,
        message: "Profile photo removed successfully",
        member: updatedMember
      });

    } catch (err) {
      console.error("Error removing profile photo:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while removing profile photo"
      });
    }
  };
  public memberLogin = async (req: Request, res: Response) => {
    const { email, password, rememberMe } = req.body;

    try {
      const member = await memberRepo.findOne({
        where: { email },
        relations: ['company'], // if needed
      });

      if (!member) {
        return res.status(404).json({ success: false, message: "Member not found" });
      }

      const isMatch = await bcrypt.compare(password, member.passwordHash || "");
      if (!isMatch) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      // Now check if password reset is forced only if credentials are valid
      if (!member.isMemberPassword) {
        return res.status(403).json({
          success: false,
          message: "Password reset required",
          forceReset: true
        });
      }

      // Continue login logic (JWT token generation, etc.)
      const token = jwt.sign(
        { memberId: member.id, email: member.email },
        process.env.JWT_SECRET!,
        {
          expiresIn: rememberMe ? "30d" : "1d",
        }
      );

      const memberDetails = {
        id: member.id,
        name: member.name,
        email: member.email,
        country: member.location,
        company: member.company
      };

      return res.status(200).json({ success: true, message: "Login successful", member: memberDetails, token });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  };

  public forgotPassword = async (
    req: Request<{}, {}, IForgotPasswordRequest>,
    res: Response
  ) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const memberRepo = AppDataSource.getRepository(Member);
      const member = await memberRepo.findOne({ where: { email } });

      if (!member) {
        return res.status(200).json({
          success: true,
          message: "If the email exists, a reset link has been sent"
        });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      const resetToken = jwt.sign(
        {
          email,
          otp,
          type: 'password_reset'
        },
        this.JWT_SECRET,
        { expiresIn: this.PASSWORD_RESET_EXPIRY }
      );

      // try {
      //   if (process.env.SMTP_EMAIL) {
      //     await transporter.sendMail({
      //       from: process.env.EMAIL_USER,
      //       to: email,
      //       subject: 'Password Reset OTP',
      //       html: `
      //                   <h2>Password Reset Request</h2>
      //                   <p>Your OTP code is: <strong>${otp}</strong></p>
      //                   <p>This OTP will expire in 15 minutes.</p>
      //                   <p>If you didn't request this, please ignore this email.</p>
      //               `
      //     });
      //   }
      // } catch (emailError) {
      //   console.error('Email sending failed:', emailError);
      //   if (process.env.NODE_ENV === 'development') {
      //     console.log(`OTP for ${email}: ${otp}`);
      //     console.log(`Reset token: ${resetToken}`);
      //   }
      // }


      return res.status(200).json({
        success: true,
        message: "OTP sent to email",
        otp,
        data: { token: resetToken }
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "An error occurred" });
    }
  };

  public verifyOTP = async (
    req: Request<{}, {}, IVerifyOTPRequest>,
    res: Response
  ) => {
    try {
      const { email, otp, token } = req.body;

      if (!email || !otp || !token) {
        return res.status(400).json({ message: "Email, OTP, and token are required" });
      }

      try {
        const decoded = jwt.verify(token, this.JWT_SECRET) as IPasswordResetToken;

        if (decoded.type !== 'password_reset' || decoded.email !== email) {
          return res.status(400).json({ message: "Invalid token" });
        }

        if (decoded.otp !== otp) {
          return res.status(400).json({ message: "Invalid OTP" });
        }

        const verifiedToken = jwt.sign(
          {
            email,
            type: 'password_reset_verified',
            verifiedAt: Date.now()
          },
          this.JWT_SECRET,
          { expiresIn: '10m' }
        );

        return res.status(200).json({
          success: true,
          message: "OTP verified successfully",
          data: { token: verifiedToken }
        });

      } catch (jwtError) {
        if (jwtError instanceof jwt.TokenExpiredError) {
          return res.status(400).json({ message: "OTP has expired" });
        }
        if (jwtError instanceof jwt.JsonWebTokenError) {
          return res.status(400).json({ message: "Invalid token" });
        }
        throw jwtError;
      }

    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "An error occurred" });
    }
  };

  public resetPassword = async (
    req: Request<{}, {}, IResetPasswordRequest>,
    res: Response
  ) => {
    try {
      const { token, newPassword } = req.body;



      if (!token || !newPassword) {
        return res.status(400).json({ message: "Token and new password are required" });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters long" });
      }

      try {
        // Verify the reset token
        const decoded = jwt.verify(token, this.JWT_SECRET) as IVerifiedResetToken;

        // Validate token type
        if (decoded.type !== 'password_reset_verified') {
          return res.status(400).json({ message: "Invalid token type" });
        }

        // Update password
        const memberRepo = AppDataSource.getRepository(Member);
        const member = await memberRepo.findOne({ where: { email: decoded.email } });

        if (!member) {
          return res.status(400).json({ message: "Member not found" });
        }

        // Check if new password is different from current password
        const isSamePassword = await bcrypt.compare(
          String(newPassword),
          String(member.passwordHash)
        );
        console.log("password:", typeof newPassword, newPassword);
        console.log("passwordHash:", typeof member.passwordHash, member.passwordHash);

        if (isSamePassword) {
          return res.status(400).json({ message: "New password must be different from current password" });
        }
        const passwordHash = await bcrypt.hash(newPassword, 10);
        member.passwordHash = passwordHash;
        member.updatedAt = new Date();
        member.isMemberPassword = true;
        await memberRepo.save(member);

        return res.status(200).json({
          success: true,
          message: "Password reset successfully"
        });

      } catch (jwtError) {
        if (jwtError instanceof jwt.TokenExpiredError) {
          return res.status(400).json({ message: "Reset token has expired" });
        }
        if (jwtError instanceof jwt.JsonWebTokenError) {
          return res.status(400).json({ message: "Invalid token" });
        }
        throw jwtError;
      }

    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "An error occurred" });
    }
  };
  public deleteMember = async (
    req: Request<{ id: string }>,
    res: Response<{ success: boolean; message: string, memberId?: string }>
  ) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ success: false, message: "Member ID is required" });
      }


      const member = await memberRepo.findOne({
        where: { id },
        relations: ['company']
      });

      if (!member) {
        return res.status(404).json({ success: false, message: "Member not found" });
      }

      // Optional: Check if the member can be deleted based on business rules
      // For example, prevent deleting the last admin or owner
      // const companyMembers = await memberRepo.find({ where: { company: { id: member.company.id } } });
      // if (companyMembers.length === 1) {
      //   return res.status(400).json({ success: false, message: "Cannot delete the last member of a company" });
      // }

      await memberRepo.delete(id);

      return res.status(200).json({ success: true, message: "Member deleted successfully", memberId: id });
    } catch (err) {
      console.error("Error deleting member:", err);
      return res.status(500).json({ success: false, message: "Server error while deleting member" });
    }
  };
  public getAvailableMembers = async (
    req: Request<{}, {}, IGetAvailableMembersRequest>,
    res: Response
  ) => {
    try {
      const { companyId, startDate, endDate, startHour, endHour, excludeProjectId } = req.body;

      // Validation
      if (
        !companyId ||
        !startDate ||
        !endDate ||
        startHour === undefined ||
        endHour === undefined
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Company ID, start date, end date, start hour, and end hour are required",
        });
      }

      // Validate date format and logic
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use yyyy-mm-dd",
        });
      }

      if (start > end) {
        return res.status(400).json({
          success: false,
          message: "Start date cannot be after end date",
        });
      }

      // Validate startHour and endHour as numbers between 0 and 24
      if (
        typeof startHour !== "number" ||
        typeof endHour !== "number" ||
        startHour < 0 ||
        startHour > 24 ||
        endHour < 0 ||
        endHour > 24
      ) {
        return res.status(400).json({
          success: false,
          message: "startHour and endHour must be numbers between 0 and 24",
        });
      }

      if (startHour >= endHour) {
        return res.status(400).json({
          success: false,
          message: "Start hour cannot be after or equal to end hour",
        });
      }

      // Fetch company
      const company = await companyRepo.findOneBy({ id: companyId });
      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found",
        });
      }

      // Fetch members with assignments and projects
      const members = await memberRepo.find({
        where: {
          company: { id: companyId },
        },
        relations: ["assignments", "assignments.project"],
        select: {
          id: true,
          profilePhoto: true,
          name: true,
          email: true,
          role: true,
          bio: true,
          location: true,
          phone: true,
          skills: true,
          assignments: {
            id: true,
            role: true,
            project: {
              id: true,
              name: true,
              startDate: true,
              endDate: true,
              startHour: true,
              endHour: true,
            },
          },
        },
      });

      // Helper methods to check conflicts
      const hasDateConflict = (
        project: any,
        startDate: string,
        endDate: string
      ): boolean => {
        const projStart = new Date(project.startDate);
        const projEnd = new Date(project.endDate);
        const start = new Date(startDate);
        const end = new Date(endDate);
        return !(end < projStart || start > projEnd);
      };

      const hasHourConflict = (
        project: any,
        startHour: number,
        endHour: number
      ): boolean => {
        // Check if time intervals overlap
        return !(endHour <= project.startHour || startHour >= project.endHour);
      };

      const availableMembers: IAvailableMemberResponse[] = [];

      for (const member of members) {
        const conflicts: IConflict[] = [];

        if (member.assignments && member.assignments.length > 0) {
          for (const assignment of member.assignments) {
            const project = assignment.project;

            if (excludeProjectId && project.id === excludeProjectId) {
              continue;
            }

            const hasDateOverlap = hasDateConflict(project, startDate, endDate);

            if (hasDateOverlap) {
              const hasHourConf = hasHourConflict(project, startHour, endHour);

              if (hasHourConf) {
                conflicts.push({
                  projectId: project.id,
                  projectName: project.name,
                  startDate: project.startDate || "",
                  endDate: project.endDate || "",
                  startHour: project.startHour || 0,
                  endHour: project.endHour || 0,
                  conflictType: "date_and_time",
                });
              } else {
                conflicts.push({
                  projectId: project.id,
                  projectName: project.name,
                  startDate: project.startDate || "",
                  endDate: project.endDate || "",
                  startHour: project.startHour || 0,
                  endHour: project.endHour || 0,
                  conflictType: "date_only",
                });
              }
            }
          }
        }

        const fullConflicts = conflicts.filter(
          (c) => c.conflictType === "date_and_time"
        );
        const dateOnlyConflicts = conflicts.filter(
          (c) => c.conflictType === "date_only"
        );

        if (conflicts.length === 0) {
          availableMembers.push({
            id: member.id,
            profilePhoto: member.profilePhoto,
            name: member.name,
            email: member.email,
            role: member.role,
            phone: member.phone || "",
            location: member.location || "",
            bio: member.bio || "",
            skills: member.skills || [],
            availabilityStatus: "fully_available",
            conflicts: [],
          });
        } else if (fullConflicts.length === 0 && dateOnlyConflicts.length > 0) {
          availableMembers.push({
            id: member.id,
            profilePhoto: member.profilePhoto,
            name: member.name,
            email: member.email,
            role: member.role,
            phone: member.phone || "",
            location: member.location || "",
            bio: member.bio || "",
            skills: member.skills || [],
            availabilityStatus: "partially_available",
            conflicts: dateOnlyConflicts,
          });
        } else {
          availableMembers.push({
            id: member.id,
            profilePhoto: member.profilePhoto,
            name: member.name,
            email: member.email,
            role: member.role,
            phone: member.phone || "",
            location: member.location || "",
            bio: member.bio || "",
            skills: member.skills || [],
            availabilityStatus: "unavailable",
            conflicts: fullConflicts,
          });
        }
      }

      return res.status(200).json({
        success: true,
        message: "Available members retrieved successfully",
        data: {
          availableMembers,
          totalFullyAvailable: availableMembers.filter(
            (m) => m.availabilityStatus === "fully_available"
          ).length,
          totalPartiallyAvailable: availableMembers.filter(
            (m) => m.availabilityStatus === "partially_available"
          ).length,
          totalUnavailable: availableMembers.filter(
            (m) => m.availabilityStatus === "unavailable"
          ).length,
          totalMembers: members.length,
          dateRange: {
            startDate,
            endDate,
            startHour,
            endHour,
          },
        },
      });
    } catch (err) {
      console.error("Error fetching available members:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while fetching available members",
      });
    }
  };


  // Helper method to check date conflicts
  private hasDateConflict(project: any, requestedStart: string, requestedEnd: string): boolean {
    // If project has no dates, no conflict
    if (!project.startDate && !project.endDate) {
      return false;
    }

    // Parse dates
    const reqStart = new Date(requestedStart);
    const reqEnd = new Date(requestedEnd);

    const projStart = project.startDate ? new Date(project.startDate) : null;
    const projEnd = project.endDate ? new Date(project.endDate) : null;

    // Case 1: Project with start date only (ongoing project)
    if (projStart && !projEnd) {
      return reqEnd >= projStart; // Conflict if requested range extends to or beyond project start
    }

    // Case 2: Project with end date only
    if (!projStart && projEnd) {
      return reqStart <= projEnd; // Conflict if requested range starts before or on project end
    }

    // Case 3: Project with both start and end dates
    if (projStart && projEnd) {
      // Conflict if the date ranges overlap
      return (reqStart <= projEnd && reqEnd >= projStart);
    }

    return false;
  }

  // Helper method to check hour conflicts
  private hasHourConflict(project: any, requestedStartHour: string, requestedEndHour: string): boolean {
    // If project has no hours, no conflict
    if (!project.startHour && !project.endHour) {
      return false;
    }

    // Case 1: Project with start hour only
    if (project.startHour && !project.endHour) {
      // If project has start hour but no end hour, assume it's ongoing
      // Conflict if requested hours overlap with or extend beyond project start hour
      return requestedEndHour > project.startHour;
    }

    // Case 2: Project with end hour only
    if (!project.startHour && project.endHour) {
      // Conflict if requested hours start before project end hour
      return requestedStartHour < project.endHour;
    }

    // Case 3: Project with both start and end hours
    if (project.startHour && project.endHour) {
      // Conflict if the time ranges overlap
      return (requestedStartHour < project.endHour && requestedEndHour > project.startHour);
    }

    return false;
  }

  public updateRingColor = async (
    req: Request<{ id: string }, {}, IUpdateRingColorRequest>,
    res: Response<IUpdateRingColorResponse>
  ) => {
    try {
      const { id: memberId } = req.params;
      const { ringColor } = req.body;
      const companyId = res.locals.token?.companyId;

      // Validate input
      if (!ringColor) {
        return res.status(400).json({
          success: false,
          message: "Ring color is required"
        });
      }

      // Validate color format (hex color or CSS color name)
      const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$|^[a-zA-Z]+$/;
      if (!colorRegex.test(ringColor)) {
        return res.status(400).json({
          success: false,
          message: "Invalid color format. Use hex color (#RRGGBB) or valid CSS color name"
        });
      }

      // Find member with company relation
      const member = await memberRepo.findOne({
        where: { id: memberId },
        relations: ["company"]
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found"
        });
      }

      // Verify member belongs to the company
      if (member.company.id !== companyId) {
        return res.status(403).json({
          success: false,
          message: "You can only update ring color for members from your own company"
        });
      }

      // Update ring color
      member.ringColor = ringColor;
      member.updatedAt = new Date();

      const updatedMember = await memberRepo.save(member);

      return res.status(200).json({
        success: true,
        message: "Ring color updated successfully",
        member: updatedMember
      });

    } catch (err) {
      console.error("Error updating ring color:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while updating ring color"
      });
    }
  };
}



export default new MemberController();
