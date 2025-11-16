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
import { CompanyMember } from "../../entity/CompanyMember";
import { Project } from "../../entity/Project";



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
        skills,
        isAdmin = false
      } = req.body;

      const companyRepo = AppDataSource.getRepository(Company);
      const memberRepo = AppDataSource.getRepository(Member);
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
      const roleRepo = AppDataSource.getRepository(Role);

      // Check if company exists
      const company = await companyRepo.findOneBy({ id: companyId });
      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found"
        });
      }

      // Check member count for the company
      const memberCount = await companyMemberRepo.count({
        where: { company: { id: companyId } }
      });

      if (memberCount >= MAX_MEMBER_PER_COMPANY) {
        return res.status(400).json({
          success: false,
          message: "Member limit reached. Maximum 20 members per company."
        });
      }

      const existingMember = await memberRepo.findOneBy({ email });
      if (existingMember) {
        // Check if member already exists in this company
        const existingCompanyMember = await companyMemberRepo.findOne({
          where: {
            member: { id: existingMember.id },
            company: { id: companyId }
          }
        });

        if (existingCompanyMember) {
          return res.status(400).json({
            success: false,
            message: "Member already exists in this company"
          });
        }
      }

      // Find the role entity by ID (not name)
      const roleEntity = await roleRepo.findOne({
        where: { id: roleId, company: { id: companyId } }
      });

      if (!roleEntity) {
        return res.status(400).json({
          success: false,
          message: "Role not found or doesn't belong to your company"
        });
      }
      let member: Member;
      let isNewMember = false;

      if (existingMember) {
        // Use existing member
        member = existingMember;
      } else {

        member = memberRepo.create({
          name,
          email,
          passwordHash: null,
          countryCode: countryCode || null,
          phone: phone || null,
          location: location || null,
          bio: bio || null,
          skills: skills || []
        });

        await memberRepo.save(member);
        isNewMember = true;

        // Send welcome email only for new members
        // if (process.env.SMTP_EMAIL) {
        //   await sendNewMemberEmail(
        //     email,
        //     name,
        //     rawPassword,
        //     company.name
        //   );
        // }
      } const companyMember = companyMemberRepo.create({
        company,
        member,
        role: roleEntity,
        isAdmin
      });

      await companyMemberRepo.save(companyMember);
      const memberWithRelations = await memberRepo.findOne({
        where: { id: member.id },
        relations: [
          'companyMembers',
          'companyMembers.company',
          'companyMembers.role'
        ]
      });

      return res.status(201).json({
        success: true,
        message: isNewMember
          ? "Member created successfully"
          : "Member added to company successfully",
        member: memberWithRelations
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  };
  public sendMemberInvite = async (
    req: Request<{}, {}, { memberId: string; companyId: string }>,
    res: Response
  ) => {
    try {
      const { memberId, companyId } = req.body;

      const memberRepo = AppDataSource.getRepository(Member);
      const companyRepo = AppDataSource.getRepository(Company);
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

      // Check if member exists
      const member = await memberRepo.findOne({
        where: { id: memberId },
        relations: ['companyMembers', 'companyMembers.company']
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found"
        });
      }

      // Check if company exists
      const company = await companyRepo.findOneBy({ id: companyId });
      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found"
        });
      }

      // Check if member belongs to this company
      const companyMember = await companyMemberRepo.findOne({
        where: {
          member: { id: memberId },
          company: { id: companyId }
        },
        relations: ['role']
      });

      if (!companyMember) {
        return res.status(400).json({
          success: false,
          message: "Member does not belong to this company"
        });
      }

      // Generate JWT token for invite
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        return res.status(500).json({
          success: false,
          message: "JWT secret not configured"
        });
      }

      const tokenPayload = {
        memberId: member.id,
        companyId: company.id,
        email: member.email,
        type: 'set_password_invite',
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60)
      };

      const token = jwt.sign(tokenPayload, jwtSecret);

      // Generate invite link
      const frontendUrl = process.env.VITE_FRONTEND_URL;
      if (!frontendUrl) {
        return res.status(500).json({
          success: false,
          message: "Frontend URL not configured"
        });
      }

      const inviteLink = `${frontendUrl}/set-password?token=${token}`;

      // Send invitation email with link
      if (process.env.SMTP_EMAIL) {
        await sendNewMemberEmail(
          member.email,
          member.name,
          inviteLink, // Send the invite link instead of password
          company.name,
          companyMember.role?.name || 'Member'
        );
      }

      // You might want to store the token in the database for validation
      // member.inviteToken = token;
      // await memberRepo.save(member);

      return res.status(200).json({
        success: true,
        message: "Invitation sent successfully",
        data: {
          inviteLink // You might want to remove this in production or only return in development
        }
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  };
  public checkMemberInvite = async (req: Request<{}, {}, { token: string }>,
    res: Response
  ) => {
    try {
      const { token } = req.body;
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        return res.status(500).json({
          success: false,
          message: "JWT secret not configured"
        });
      }
      // Verify JWT token
      let decoded: any;
      try {
        decoded = jwt.verify(token, jwtSecret) as any;
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired token"
        });
      }
      const memberRepo = AppDataSource.getRepository(Member);
      const member = await memberRepo.findOne({
        where: { email: decoded.email }
      });
      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Invalid or expired token"
        });
      }
      if (member.passwordHash != null) {
        return res.status(404).json({
          success: false,
          message: "Invalid or expired token"
        });
      }
      return res.status(200).json({
        success: true,
        message: "Token is Valid"
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
  public setMemberPassword = async (
    req: Request<{}, {}, { token: string; password: string }>,
    res: Response
  ) => {
    try {
      const { token, password } = req.body;

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        return res.status(500).json({
          success: false,
          message: "JWT secret not configured"
        });
      }

      // Verify JWT token
      let decoded;
      try {
        decoded = jwt.verify(token, jwtSecret) as any;
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired token"
        });
      }

      // Check if token is for set password invite
      if (decoded.type !== 'set_password_invite') {
        return res.status(400).json({
          success: false,
          message: "Invalid token type"
        });
      }

      const memberRepo = AppDataSource.getRepository(Member);

      const member = await memberRepo.findOne({
        where: { id: decoded.memberId },
        relations: ['companyMembers', 'companyMembers.company', 'companyMembers.role'],
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found"
        });
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(password, 10);

      // Update member password and clear any invite token
      member.passwordHash = passwordHash;
      // member.inviteToken = null; // If you stored the token
      await memberRepo.save(member);

      const primaryCompanyMember = member.companyMembers[0];
      const primaryCompany = primaryCompanyMember.company;
      const companyId = primaryCompany?.id ?? null;

      const associatedCompanies = member.companyMembers.map((cm) => ({
        id: cm.company.id,
        name: cm.company.name,
        email: cm.company.email,
        country: cm.company.country,
        isAdmin: cm.isAdmin,
        role: cm.role ? cm.role.name : null,
        roleId: cm.role ? cm.role.id : null
      }));
      // Create JWT with user type based on isAdmin

      const newToken = jwt.sign(
        {
          memberId: member.id,
          companyId: companyId,
          isAdmin: primaryCompanyMember.isAdmin,
          companyMemberId: primaryCompanyMember.id
        },
        process.env.JWT_SECRET!,
        { expiresIn: "1d" }
      );

      // Build unified user response
      const userData = {
        id: member.id,
        name: member.name,
        email: member.email,
        role: primaryCompanyMember.role ? primaryCompanyMember.role.name : null,
        roleId: primaryCompanyMember.role ? primaryCompanyMember.role.id : null,
        isAdmin: primaryCompanyMember.isAdmin,
        location: member.location ?? null,
        profilePhoto: member.profilePhoto ?? null,
        phone: member.phone ?? null,
        countryCode: member.countryCode ?? null,
        company: {
          id: companyId,
          name: primaryCompany?.name ?? null,
          email: primaryCompany?.email ?? null,
          country: primaryCompany?.country ?? null,
        },
        associatedCompanies,
        companyMemberId: primaryCompanyMember.id
      };

      return res.status(200).json({
        success: true,
        message: "Password set successfully",
        token: newToken,
        user: userData
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

      const companyRepo = AppDataSource.getRepository(Company);
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
      const projectRepo = AppDataSource.getRepository(Project)

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

      // Build query for company members with relations
      const queryBuilder = companyMemberRepo.createQueryBuilder('companyMember')
        .leftJoinAndSelect('companyMember.member', 'member')
        .leftJoinAndSelect('companyMember.role', 'role')
        .leftJoinAndSelect('member.assignments', 'assignments')
        .leftJoinAndSelect('assignments.role', 'assignmentRole')
        .leftJoinAndSelect('assignments.project', 'project')
        .where('companyMember.companyId = :companyId', { companyId });

      // If memberId is provided, filter for that specific member
      // if (memberId) {
      //   queryBuilder.andWhere('member.id = :memberId', { memberId });
      // }

      const companyMembers = await queryBuilder
        .orderBy('companyMember.createdAt', 'DESC')
        .getMany();

      // If memberId was provided but no member found, return error
      if (memberId && companyMembers.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this company"
        });
      }
      const companyProjects = await projectRepo.find({
        where: { company: { id: companyId } },
        select: ['id']
      });
      const companyProjectIds = new Set(companyProjects.map(p => p.id));

      // Format the response with proper type conversion and date filtering
      let membersResponse: IMemberResponse[] = companyMembers.map(companyMember => {
        const member = companyMember.member;

        // Filter assignments to only include projects that fall within the requested date range
        const filteredAssignments = member.assignments?.filter(assignment => {
          const project = assignment.project;

          if (!companyProjectIds.has(project.id)) {
            return false; // Skip projects not belonging to this company
          }
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

        const isInvited = !member.passwordHash || member.passwordHash === '';

        return {
          id: member.id,
          name: member.name,
          email: member.email,
          role: companyMember.role?.name || 'No Role Assigned', // Get role from CompanyMember
          roleId: companyMember.role?.id || "",
          phone: member.phone || '',
          countryCode: member.countryCode || '',
          location: member.location || '',
          bio: member.bio || '',
          profilePhoto: member.profilePhoto || '',
          ringColor: member.ringColor || '',
          active: companyMember.active,
          isAdmin: companyMember.isAdmin, // Get admin status from CompanyMember
          skills: member.skills || [],
          companyId: companyId,
          companyMemberId: companyMember.id,
          isInvited: isInvited,
          isOwner: company.email == member.email,
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

      const companyRepo = AppDataSource.getRepository(Company);
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
      const projectRepo = AppDataSource.getRepository(Project);

      const company = await companyRepo.findOneBy({ id: companyId });
      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found"
        });
      }

      // Get current date in YYYY-MM-DD format
      const currentDate = new Date().toISOString().split('T')[0];

      // Build query for company members with relations
      const queryBuilder = companyMemberRepo.createQueryBuilder('companyMember')
        .leftJoinAndSelect('companyMember.member', 'member')
        .leftJoinAndSelect('companyMember.role', 'role')
        .leftJoinAndSelect('member.assignments', 'assignments')
        .leftJoinAndSelect('assignments.role', 'assignmentRole')
        .leftJoinAndSelect('assignments.project', 'project')
        .where('companyMember.companyId = :companyId', { companyId });

      // If memberId is provided, filter for that specific member
      if (memberId) {
        queryBuilder.andWhere('member.id = :memberId', { memberId });
      }

      const companyMembers = await queryBuilder
        .orderBy('member.name', 'ASC')
        .getMany();

      // If memberId was provided but no member found, return error
      if (memberId && companyMembers.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this company"
        });
      }
      // Get all company projects for validation
      const companyProjects = await projectRepo.find({
        where: { company: { id: companyId } },
        select: ['id']
      });

      const companyProjectIds = new Set(companyProjects.map(p => p.id));

      // Format the response with proper type conversion and date filtering
      const membersResponse: any[] = companyMembers.map(companyMember => {
        const member = companyMember.member;

        // Filter assignments to only include current and future projects
        const filteredAssignments = member.assignments?.filter(assignment => {
          const project = assignment.project;

          if (!companyProjectIds.has(project.id)) {
            return false; // Skip projects not belonging to this company
          }

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
          role: companyMember.role?.name || 'No Role Assigned', // Get from CompanyMember
          roleId: companyMember.role?.id || "",
          phone: member.phone || '',
          countryCode: member.countryCode || '',
          location: member.location || '',
          bio: member.bio || '',
          profilePhoto: member.profilePhoto || '',
          ringColor: member.ringColor || '',
          active: companyMember.active,
          isAdmin: companyMember.isAdmin, // Get from CompanyMember
          skills: member.skills || [],
          companyId: companyId,
          companyMemberId: companyMember.id, // Include junction table ID
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
      const {
        name,
        email,
        roleId,
        phone,
        countryCode,
        location,
        bio,
        skills,
        profilePhoto,
        isAdmin,
        ringColor
      } = req.body;

      const companyId = res.locals.token?.companyId;

      if (!companyId) {
        return res.status(400).json({
          success: false,
          message: "Company ID is required"
        });
      }

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
        roleId === undefined &&
        phone === undefined &&
        countryCode === undefined &&
        location === undefined &&
        bio === undefined &&
        skills === undefined &&
        profilePhoto === undefined &&
        isAdmin === undefined &&
        ringColor === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "At least one field must be provided for update"
        });
      }

      const memberRepo = AppDataSource.getRepository(Member);
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
      const roleRepo = AppDataSource.getRepository(Role);

      // Find member with company member relations
      const member = await memberRepo.findOne({
        where: { id: memberId },
        relations: ["companyMembers", "companyMembers.company", "companyMembers.role"]
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found"
        });
      }

      // Find the company member relation for this specific company
      const companyMember = member.companyMembers?.find(
        cm => cm.company.id === companyId
      );

      if (!companyMember) {
        return res.status(403).json({
          success: false,
          message: "Member does not belong to this company"
        });
      }

      // Update member fields if provided
      if (name !== undefined) member.name = name;
      if (email !== undefined) member.email = email;
      if (countryCode !== undefined) member.countryCode = countryCode;
      if (phone !== undefined) member.phone = phone;
      if (location !== undefined) member.location = location;
      if (bio !== undefined) member.bio = bio;
      if (skills !== undefined) member.skills = skillsArray;
      if (profilePhoto !== undefined) member.profilePhoto = profilePhoto;
      if (ringColor !== undefined) member.ringColor = ringColor;

      // Update CompanyMember relation fields if provided
      if (roleId !== undefined) {
        if (roleId === null) {
          // Remove role assignment
          companyMember.role = null;
        } else {
          // Find the role entity by ID and verify it belongs to company
          const roleEntity = await roleRepo.findOne({
            where: { id: roleId, company: { id: companyId } }
          });

          if (!roleEntity) {
            return res.status(400).json({
              success: false,
              message: "Role not found or doesn't belong to your company"
            });
          }
          companyMember.role = roleEntity;
        }
      }

      if (isAdmin !== undefined) {
        companyMember.isAdmin = isAdmin;
      }

      // Save both member and companyMember updates
      await memberRepo.save(member);
      await companyMemberRepo.save(companyMember);

      // Fetch the updated member with all relations
      const updatedMember = await memberRepo.findOne({
        where: { id: memberId },
        relations: [
          "companyMembers",
          "companyMembers.company",
          "companyMembers.role"
        ]
      });

      if (!updatedMember) {
        return res.status(404).json({
          success: false,
          message: "Member not found after update"
        });
      }

      // Find the updated company member relation for response
      const updatedCompanyMember = updatedMember.companyMembers?.find(
        cm => cm.company.id === companyId
      );

      // Format response to include company-specific data
      const responseMember = {
        ...updatedMember,
        role: updatedCompanyMember?.role || null,
        roleId: updatedCompanyMember?.role?.id || null,
        isAdmin: updatedCompanyMember?.isAdmin || false,
        companyMemberId: updatedCompanyMember?.id
      };

      return res.status(200).json({
        success: true,
        message: "Member updated successfully",
        member: responseMember
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
      const memberRepo = AppDataSource.getRepository(Member);
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

      const memberRepo = AppDataSource.getRepository(Member);
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
    const { email, password, rememberMe } = req.body;

    try {
      const memberRepo = AppDataSource.getRepository(Member);
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
      const lowerCaseEmail = email.toLowerCase();

      const member = await memberRepo.findOne({
        where: { email: lowerCaseEmail },
        relations: ['companyMembers', 'companyMembers.company', 'companyMembers.role'],
      });

      if (!member) {
        return res.status(404).json({ success: false, message: "Invalid credentials" });
      }

      if (!member.companyMembers || member.companyMembers.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Member is not associated with any company"
        });
      }
      const isMatch = await bcrypt.compare(password, member.passwordHash || "");
      if (!isMatch) {
        return res.status(401).json({ success: false, message: "Invalid credentials" });
      }

      const primaryCompanyMember = member.companyMembers[0];
      const primaryCompany = primaryCompanyMember.company;
      const companyId = primaryCompany?.id ?? null;

      const associatedCompanies = member.companyMembers.map((cm) => ({
        id: cm.company.id,
        name: cm.company.name,
        email: cm.company.email,
        country: cm.company.country,
        isAdmin: cm.isAdmin,
        role: cm.role ? cm.role.name : null,
        roleId: cm.role ? cm.role.id : null
      }));
      // Create JWT with user type based on isAdmin

      const token = jwt.sign(
        {
          memberId: member.id,
          companyId: companyId,
          isAdmin: primaryCompanyMember.isAdmin,
          companyMemberId: primaryCompanyMember.id
        },
        process.env.JWT_SECRET!,
        { expiresIn: rememberMe ? "30d" : "1d" }
      );

      // Build unified user response
      const userData = {
        id: member.id,
        name: member.name,
        email: member.email,
        role: primaryCompanyMember.role ? primaryCompanyMember.role.name : null,
        roleId: primaryCompanyMember.role ? primaryCompanyMember.role.id : null,
        isAdmin: primaryCompanyMember.isAdmin,
        location: member.location ?? null,
        profilePhoto: member.profilePhoto ?? null,
        phone: member.phone ?? null,
        countryCode: member.countryCode ?? null,
        company: {
          id: companyId,
          name: primaryCompany?.name ?? null,
          email: primaryCompany?.email ?? null,
          country: primaryCompany?.country ?? null,
        },
        associatedCompanies,
        companyMemberId: primaryCompanyMember.id
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

      const memberRepo = AppDataSource.getRepository(Member);
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
  public removeMemberFromCompany = async (
    req: Request<{ companyId: string; memberId: string }>,
    res: Response<{ success: boolean; message: string; memberId?: string; companyId?: string }>
  ) => {
    try {
      const { companyId, memberId } = req.params;

      if (!companyId || !memberId) {
        return res.status(400).json({
          success: false,
          message: "Company ID and Member ID are required"
        });
      }

      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
      const companyRepo = AppDataSource.getRepository(Company);

      // Find the company-member relationship
      const companyMember = await companyMemberRepo.findOne({
        where: {
          company: { id: companyId },
          member: { id: memberId }
        },
        relations: ['company', 'member']
      });

      if (!companyMember) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this company"
        });
      }
      const company = await companyRepo.findOne({
        where: { id: companyId },
        select: ['id', 'email']
      });

      if (company && companyMember.member.email === company.email) {
        return res.status(400).json({
          success: false,
          message: "Cannot remove the company owner from the company"
        });
      }


      // Optional: Check if this is the last admin in the company
      // You might want to prevent removing the last admin
      // if (companyMember.isAdmin) {
      //   const adminCount = await companyMemberRepo.count({
      //     where: { 
      //       company: { id: companyId },
      //       isAdmin: true,
      //       active: true
      //     }
      //   });

      //   if (adminCount === 1) {
      //     return res.status(400).json({ 
      //       success: false, 
      //       message: "Cannot remove the last admin from the company. Please assign another admin first." 
      //     });
      //   }
      // }

      // Soft delete by setting active to false (recommended approach)
      // companyMember.active = false;
      // await companyMemberRepo.save(companyMember);

      // OR Hard delete (permanently remove the relationship)
      await companyMemberRepo.delete(companyMember.id);

      return res.status(200).json({
        success: true,
        message: "Member removed from company successfully",
        memberId,
        companyId
      });
    } catch (err) {
      console.error("Error removing member from company:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while removing member from company"
      });
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
      const companyRepo = AppDataSource.getRepository(Company);
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
      const memberRepo = AppDataSource.getRepository(Member);

      const company = await companyRepo.findOneBy({ id: companyId });
      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found",
        });
      }

      // Fetch company members with assignments and projects
      const companyMembers = await companyMemberRepo.find({
        where: {
          company: { id: companyId },
        },
        relations: [
          "member",
          "member.assignments",
          "member.assignments.role",
          "member.assignments.project",
          "role"
        ],
        select: {
          id: true,
          isAdmin: true,
          role: {
            id: true,
            name: true
          },
          member: {
            id: true,
            profilePhoto: true,
            name: true,
            email: true,
            bio: true,
            location: true,
            phone: true,
            countryCode: true,
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

      for (const companyMember of companyMembers) {
        const member = companyMember.member;
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
            role: companyMember.role?.name || "", // Get role from CompanyMember
            roleId: companyMember.role?.id || "", // Include roleId
            phone: member.phone || "",
            countryCode: member.countryCode || "",
            location: member.location || "",
            bio: member.bio || "",
            skills: member.skills || [],
            isAdmin: companyMember.isAdmin, // Include admin status
            companyMemberId: companyMember.id, // Include junction table ID
            availabilityStatus: "fully_available",
            conflicts: [],
          });
        } else if (fullConflicts.length === 0 && dateOnlyConflicts.length > 0) {
          availableMembers.push({
            id: member.id,
            profilePhoto: member.profilePhoto,
            name: member.name,
            email: member.email,
            role: companyMember.role?.name || "",
            roleId: companyMember.role?.id || "",
            phone: member.phone || "",
            countryCode: member.countryCode || "",
            location: member.location || "",
            bio: member.bio || "",
            skills: member.skills || [],
            isAdmin: companyMember.isAdmin,
            companyMemberId: companyMember.id,
            availabilityStatus: "partially_available",
            conflicts: dateOnlyConflicts,
          });
        } else {
          availableMembers.push({
            id: member.id,
            profilePhoto: member.profilePhoto,
            name: member.name,
            email: member.email,
            role: companyMember.role?.name || "",
            roleId: companyMember.role?.id || "",
            phone: member.phone || "",
            countryCode: member.countryCode || "",
            location: member.location || "",
            bio: member.bio || "",
            skills: member.skills || [],
            isAdmin: companyMember.isAdmin,
            companyMemberId: companyMember.id,
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
          totalMembers: companyMembers.length,
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

      const memberRepo = AppDataSource.getRepository(Member);
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

      // Find member
      const member = await memberRepo.findOne({
        where: { id: memberId }
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: "Member not found"
        });
      }

      // If companyId is provided, verify the member belongs to the company
      if (companyId) {
        const companyMember = await companyMemberRepo.findOne({
          where: {
            member: { id: memberId },
            company: { id: companyId }
          }
        });

        if (!companyMember) {
          return res.status(403).json({
            success: false,
            message: "Member does not belong to this company"
          });
        }
      }

      // Update ring color (this is member-specific, not company-specific)
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

      if (!memberId || !companyId) {
        return res.status(400).json({
          success: false,
          message: "Member ID and Company ID are required",
          newStatus: false
        });
      }

      const memberRepo = AppDataSource.getRepository(Member);
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

      // Find company member relation
      const companyMember = await companyMemberRepo.findOne({
        where: {
          member: { id: memberId },
          company: { id: companyId }
        },
        relations: ['member', 'company', 'role']
      });

      if (!companyMember) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this company",
          newStatus: false
        });
      }

      // Toggle the company-specific active status
      const newStatus = !companyMember.active;
      companyMember.active = newStatus;
      companyMember.updatedAt = new Date();

      const updatedCompanyMember = await companyMemberRepo.save(companyMember);

      const statusMessage = newStatus ? "activated" : "deactivated";

      // Fetch updated member with relations for response
      const updatedMember = await memberRepo.findOne({
        where: { id: memberId },
        relations: ['companyMembers', 'companyMembers.company', 'companyMembers.role']
      });

      return res.status(200).json({
        success: true,
        message: `Member ${statusMessage} successfully in this company`,
        member: {
          ...updatedMember,
          active: newStatus, // Include the company-specific active status
          companyMemberId: companyMember.id
        },
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

      if (!memberId || !companyId) {
        return res.status(400).json({
          success: false,
          message: "Member ID and Company ID are required",
          isAdmin: false
        });
      }

      const memberRepo = AppDataSource.getRepository(Member);
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
      const companyRepo = AppDataSource.getRepository(Company);

      // Find company member relation
      const companyMember = await companyMemberRepo.findOne({
        where: {
          member: { id: memberId },
          company: { id: companyId }
        },
        relations: ['member', 'company', 'role']
      });

      if (!companyMember) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this company",
          isAdmin: false
        });
      }

      const company = await companyRepo.findOne({
        where: { id: companyId }
      });

      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found",
          isAdmin: companyMember.isAdmin
        });
      }

      // Check if this member is the main company admin (same email as company)
      if (companyMember.member.email === company.email) {
        return res.status(403).json({
          success: false,
          message: "Cannot modify admin status for the main company administrator",
          isAdmin: companyMember.isAdmin
        });
      }

      // Toggle company-specific admin status
      const newAdminStatus = !companyMember.isAdmin;
      companyMember.isAdmin = newAdminStatus;
      companyMember.updatedAt = new Date();

      const updatedCompanyMember = await companyMemberRepo.save(companyMember);

      const statusMessage = newAdminStatus ? "added" : "removed";

      // Fetch updated member with relations for response
      const updatedMember = await memberRepo.findOne({
        where: { id: memberId },
        relations: ['companyMembers', 'companyMembers.company', 'companyMembers.role']
      });

      return res.status(200).json({
        success: true,
        message: `Admin privileges ${statusMessage} successfully`,
        member: {
          ...updatedMember,
          isAdmin: newAdminStatus,
          active: companyMember.active, // Include current active status
          companyMemberId: companyMember.id
        },
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
