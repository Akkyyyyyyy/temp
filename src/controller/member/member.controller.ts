import { Request, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { Member } from "../../entity/Member";
import { Company } from "../../entity/Company";
import { Role } from "../../entity/Role";
import { IAvailableMemberResponse, IConflict, ICreateMemberRequest, ICreateMemberResponse, IGetAvailableMembersRequest, IGetMembersByCompanyRequest, IGetMembersByCompanyResponse, IGetMembersWithProjectsRequest, IGetMembersWithProjectsResponse, IMemberResponse, IMemberWithProjectsResponse, IToggleAdminRequest, IToggleAdminResponse, IToggleMemberStatusResponse, IUpdateMemberRequest, IUpdateMemberResponse, IUpdateRingColorRequest, IUpdateRingColorResponse } from "./types";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { deleteFromS3, uploadToS3 } from "../../utils/s3upload";
import { MAX_MEMBER_PER_COMPANY } from "../../constants/constant";
import { generatePassword } from "../../helper/helper";
import { sendEmail, sendNewMemberEmail } from "../../utils/mailer";


const memberRepo = AppDataSource.getRepository(Member);
const companyRepo = AppDataSource.getRepository(Company);

class MemberController {
  public createMember = async (
    req: Request<{}, {}, ICreateMemberRequest>,
    res: Response<ICreateMemberResponse>
  ) => {
    try {
      const {
        name,
        email,
        roleId,
        companyId,
        countryCode,
        phone,
        location,
        bio,
        skills
      } = req.body;

      const company = await AppDataSource.getRepository(Company).findOneBy({ id: companyId });
      if (!company) return res.status(404).json({ success: false, message: "Company not found" });

      // Check member count for the company
      const memberCount = await memberRepo.count({
        where: { company: { id: companyId } }
      });

      if (memberCount >= MAX_MEMBER_PER_COMPANY) {
        return res.status(400).json({
          success: false,
          message: "Member limit reached. Maximum 20 members per company."
        });
      }

      const existing = await memberRepo.findOneBy({ email });
      if (existing) return res.status(400).json({ success: false, message: "Email already exists" });

      // Find the role entity by ID (not name)
      const roleRepo = AppDataSource.getRepository(Role);
      const roleEntity = await roleRepo.findOne({
        where: { id: roleId, company: { id: companyId } } // Also verify role belongs to company
      });


      if (!roleEntity) {
        return res.status(400).json({
          success: false,
          message: "Role not found or doesn't belong to your company"
        });
      }

      const rawPassword = generatePassword(6);
      const passwordHash = await bcrypt.hash(rawPassword, 10);
      const member = memberRepo.create({
        name,
        email,
        role: roleEntity, // Store the role entity
        passwordHash,
        company: { id: companyId },
        countryCode: countryCode || null,
        phone: phone || null,
        location: location || null,
        bio: bio || null,
        skills: skills || [], // Default to empty array if not provided
      });

      await memberRepo.save(member);
      if (process.env.SMTP_EMAIL) {
        await sendNewMemberEmail(
          email,
          name,
          rawPassword,
          company?.name // Pass company name for the template
        );
      }

      return res.status(201).json({
        success: true,
        message: "Member Created Successfully",
        member
      });
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
      // if (memberId) {
      //   whereCondition.id = memberId;
      // }

      const members = await memberRepo.find({
        where: whereCondition,
        relations: [
          "role",
          "assignments",
          "assignments.role",
          "assignments.project"
        ],
        select: {
          id: true,
          name: true,
          email: true,
          role: {
            id: true,
            name: true
          },
          bio: true,
          profilePhoto: true,
          location: true,
          phone: true,
          countryCode: true,
          skills: true,
          ringColor: true,
          active: true,
          isAdmin: true,
          assignments: {
            id: true,
            role: {
              id: true,
              name: true
            },
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
      let membersResponse: IMemberResponse[] = members.map(member => {
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
          role: member.role?.name || 'No Role Assigned',
          roleId: member.role?.id || "",
          phone: member.phone || '',
          countryCode: member.countryCode || '',
          location: member.location || '',
          bio: member.bio || '',
          profilePhoto: member.profilePhoto || '',
          ringColor: member.ringColor || '',
          active: member.active,
          isAdmin: member.isAdmin,
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
              newRole: assignment.role?.name || "",
              roleId: assignment.role?.id || "",
              brief: assignment.project.brief,
              logistics: assignment.project.logistics
            };
          })
        };
      });

      // If memberId is provided, sort to put that member first
      if (memberId) {
        membersResponse = membersResponse.sort((a, b) => {
          // Put the requested member at the top
          if (a.id === memberId) return -1;
          if (b.id === memberId) return 1;
          return 0;
        });
      }

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

  public getMembersWithCurrentFutureProjects = async (
    req: Request<{}, {}, IGetMembersWithProjectsRequest>,
    res: Response<IGetMembersWithProjectsResponse>
  ) => {
    try {
      const { companyId, memberId } = req.body;

      if (!companyId) {
        return res.status(400).json({
          success: false,
          message: "Company ID is required"
        });
      }

      const company = await companyRepo.findOneBy({ id: companyId });
      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found"
        });
      }

      // Get current date in YYYY-MM-DD format
      const currentDate = new Date().toISOString().split('T')[0];

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
          "role",
          "assignments",
          "assignments.role",
          "assignments.project"
        ],
        select: {
          id: true,
          name: true,
          email: true,
          role: {
            id: true,
            name: true
          },
          bio: true,
          profilePhoto: true,
          location: true,
          phone: true,
          countryCode: true,
          skills: true,
          ringColor: true,
          active: true,
          assignments: {
            id: true,
            role: {
              id: true,
              name: true
            },
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
      const membersResponse: any[] = members.map(member => {
        // Filter assignments to only include current and future projects
        const filteredAssignments = member.assignments?.filter(assignment => {
          const project = assignment.project;

          // If project has no end date, include it (considered ongoing)
          if (!project.endDate) {
            return true;
          }

          // If project has end date, check if it's current or future
          // Current: endDate >= currentDate
          // Future: startDate > currentDate (but we'll include anything that hasn't ended yet)
          const projectEndDate = project.endDate;

          // Include projects that haven't ended yet (endDate is today or in future)
          return projectEndDate >= currentDate;
        }) || [];

        return {
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role?.name || 'No Role Assigned',
          roleId: member.role?.id || "",
          phone: member.phone || '',
          countryCode: member.countryCode || '',
          location: member.location || '',
          bio: member.bio || '',
          profilePhoto: member.profilePhoto || '',
          ringColor: member.ringColor || '',
          active: member.active,
          skills: member.skills || [],
          companyId: companyId,
          projects: filteredAssignments.map(assignment => {
            // Determine project status
            let status: 'current' | 'upcoming' = 'current';
            const projectStartDate = assignment.project.startDate;

            if (projectStartDate && projectStartDate > currentDate) {
              status = 'upcoming';
            }

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
              newRole: assignment.role?.name || "",
              roleId: assignment.role?.id || "",
              brief: assignment.project.brief,
              logistics: assignment.project.logistics,
              status: status // Add status to indicate if it's current or upcoming
            };
          })
        };
      });

      // Calculate summary statistics
      const totalMembers = membersResponse.length;
      const totalProjects = membersResponse.reduce((sum, member) => sum + member.projects.length, 0);
      const currentProjects = membersResponse.reduce((sum, member) =>
        sum + member.projects.filter(p => p.status === 'current').length, 0
      );
      const upcomingProjects = membersResponse.reduce((sum, member) =>
        sum + member.projects.filter(p => p.status === 'upcoming').length, 0
      );

      return res.status(200).json({
        success: true,
        message: memberId
          ? `Member with current and future projects retrieved successfully`
          : `Members with current and future projects retrieved successfully`,
        members: membersResponse,
        totalCount: totalMembers,
        summary: {
          totalProjects,
          currentProjects,
          upcomingProjects,
          asOfDate: currentDate
        }
      });

    } catch (err) {
      console.error("Error fetching members with projects:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while fetching members with projects"
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
      const { name, email, role, phone, countryCode, location, bio, skills, profilePhoto, roleId } = req.body; // Add countryCode
      const companyId = res.locals.token?.companyId;

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
        countryCode === undefined && // Add this line
        location === undefined &&
        bio === undefined &&
        skills === undefined &&
        profilePhoto === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "At least one field must be provided for update"
        });
      }

      const member = await memberRepo.findOne({
        where: { id: memberId },
        relations: ["company", "role"] // Include role relation
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found"
        });
      }



      // Update fields if provided
      if (name !== undefined) member.name = name;
      if (email !== undefined) member.email = email;
      if (countryCode !== undefined) member.countryCode = countryCode; // Add this line

      if (role !== undefined && roleId !== null) {
        // Find the role entity by ID (not name)
        const roleRepo = AppDataSource.getRepository(Role);
        const roleEntity = await roleRepo.findOne({
          where: { id: roleId, company: { id: companyId } } // Verify role belongs to company
        });

        if (!roleEntity) {
          return res.status(400).json({
            success: false,
            message: "Role not found or doesn't belong to your company"
          });
        }
        member.role = roleEntity;
      }

      if (phone !== undefined) member.phone = phone;
      if (location !== undefined) member.location = location;
      if (bio !== undefined) member.bio = bio;
      if (skills !== undefined) member.skills = skillsArray;
      if (profilePhoto !== undefined) member.profilePhoto = profilePhoto;

      await memberRepo.save(member);

      // Fetch the updated member with all relations to ensure complete data
      const updatedMember = await memberRepo.findOne({
        where: { id: memberId },
        relations: ["company", "role"] // Include role relation to get complete role data
      });

      if (!updatedMember) {
        return res.status(404).json({
          success: false,
          message: "Member not found after update"
        });
      }

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
    const { email, password, rememberMe, userType } = req.body;

    try {
      const memberRepo = AppDataSource.getRepository(Member);
      const lowerCaseEmail = email.toLowerCase();

      const member = await memberRepo.findOne({
        where: { email:lowerCaseEmail },
        relations: ['company', 'role'],
      });

      if (!member) {
        return res.status(404).json({ success: false, message: "Invalid credentials" });
      }

      // Validate user type based on isAdmin status
      if (userType === "company" && !member.isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Member cannot login as company"
        });
      }

      if (userType === "member" && member.isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Admin cannot login as member"
        });
      }
      const isMatch = await bcrypt.compare(password, member.passwordHash || "");
      if (!isMatch) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }


      // Force password reset flow
      if (!member.isMemberPassword) {
        return res.status(403).json({
          success: false,
          message: "Password reset required",
          forceReset: true
        });
      }

      // Create JWT with user type based on isAdmin
      const type = member.isAdmin ? "admin" : "member";

      const token = jwt.sign(
        {
          memberId: member.id,
          companyId: member.company?.id,
          userType: type,
          isAdmin: member.isAdmin ?? false
        },
        process.env.JWT_SECRET!,
        { expiresIn: rememberMe ? "30d" : "1d" }
      );

      // Build unified user response
      const userData = {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role ? member.role.name : null,
        isAdmin: member.isAdmin ?? false,
        userType: type,
        location: member.location ?? null,
        company: {
          id: member.company?.id ?? null,
          name: member.company?.name ?? null,
          email: member.company.email,
          country: member.company?.country ?? null,
        }
      };

      return res.status(200).json({
        success: true,
        message: "Login successful",
        token,
        user: userData
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Server error" });
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
        relations: ["role", "assignments", "assignments.role", "assignments.project"],
        select: {
          id: true,
          profilePhoto: true,
          name: true,
          email: true,
          role: {
            id: true,
            name: true
          },
          bio: true,
          location: true,
          phone: true,
          countryCode: true, // Add this line
          skills: true,
          assignments: {
            id: true,
            role: {
              id: true,
              name: true
            },
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
            role: member.role?.name || "",
            phone: member.phone || "",
            countryCode: member.countryCode || "", // Add this line
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
            role: member.role?.name || "",
            phone: member.phone || "",
            countryCode: member.countryCode || "", // Add this line
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
            role: member.role?.name || "",
            phone: member.phone || "",
            countryCode: member.countryCode || "", // Add this line
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

  public toggleMemberStatus = async (
    req: Request<{ id: string }>,
    res: Response<IToggleMemberStatusResponse>
  ) => {
    try {
      const { id: memberId } = req.params;
      const companyId = res.locals.token?.companyId;

      if (!memberId) {
        return res.status(400).json({
          success: false,
          message: "Member ID is required",
          newStatus: false
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
          message: "Member not found",
          newStatus: false
        });
      }

      // Verify member belongs to the company
      // if (member.company.id !== companyId) {
      //   return res.status(403).json({
      //     success: false,
      //     message: "You can only toggle status for members from your own company",
      //     newStatus: member.active
      //   });
      // }

      // Toggle the active status
      const newStatus = !member.active;
      member.active = newStatus;
      member.updatedAt = new Date();

      const updatedMember = await memberRepo.save(member);

      const statusMessage = newStatus ? "activated" : "deactivated";

      return res.status(200).json({
        success: true,
        message: `Member ${statusMessage} successfully`,
        member: updatedMember,
        newStatus
      });

    } catch (err) {
      console.error("Error toggling member status:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while toggling member status",
        newStatus: false
      });
    }
  };
  public toggleAdmin = async (
    req: Request<{}, {}, IToggleAdminRequest>,
    res: Response<IToggleAdminResponse>
  ) => {
    try {
      const { memberId } = req.body;
      const companyId = res.locals.token?.companyId;

      if (!memberId) {
        return res.status(400).json({
          success: false,
          message: "Member ID is required",
          isAdmin: false
        });
      }

      const member = await memberRepo.findOne({
        where: { id: memberId },
        relations: ["company", "role"]
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found",
          isAdmin: false
        });
      }

      if (member.company.id !== companyId) {
        return res.status(403).json({
          success: false,
          message: "You can only modify admin status for members from your own company",
          isAdmin: member.isAdmin
        });
      }

      const company = await companyRepo.findOne({
        where: { id: companyId }
      });

      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found",
          isAdmin: member.isAdmin
        });
      }

      // Check if this member is the main company admin (same email as company)
      if (member.email === company.email) {
        return res.status(403).json({
          success: false,
          message: "Cannot modify admin status for the main company administrator",
          isAdmin: member.isAdmin
        });
      }

      const newAdminStatus = !member.isAdmin;
      member.isAdmin = newAdminStatus;
      member.updatedAt = new Date();

      const updatedMember = await memberRepo.save(member);

      const statusMessage = newAdminStatus ? "added" : "removed";

      return res.status(200).json({
        success: true,
        message: `Admin privileges ${statusMessage} successfully`,
        member: updatedMember,
        isAdmin: newAdminStatus
      });

    } catch (err) {
      console.error("Error toggling admin status:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while toggling admin status",
        isAdmin: false
      });
    }
  };
}



export default new MemberController();
