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
import { Events } from "../../entity/Events";
import { EventAssignment } from "../../entity/EventAssignment";
import GoogleCalendarService from "../../utils/GoogleCalendarService";
import { calendar } from '@googleapis/calendar';



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
          email,
          passwordHash: null,
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
        name,
        phone: phone || null,
        location: location || null,
        bio: bio || null,
        skills: skills || [],
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
    req: Request<{}, {}, { memberId: string; companyId: string, adminName: string }>,
    res: Response
  ) => {
    try {
      const { memberId, companyId, adminName } = req.body;

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
        companyName: companyMember.name,
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
          companyMember.name,
          inviteLink, // Send the invite link instead of password
          company.name,
          adminName,
          companyMember.role?.name || 'Member',
        );
      }
      companyMember.invitation = 'sent';
      await companyMemberRepo.save(companyMember);
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
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);
      const member = await memberRepo.findOne({
        where: { email: decoded.email }
      });
      const companyMember = await companyMemberRepo.findOne({
        where: {
          member: { id: decoded.memberId },
          company: { id: decoded.companyId }
        },
        relations: ['role']
      });
      if (!member && companyMember) {
        return res.status(404).json({
          success: false,
          message: "Invalid or expired token"
        });
      }
      if (member.passwordHash != null && (companyMember.invitation == "accepted" || companyMember.invitation == "rejected")) {
        return res.status(404).json({
          success: false,
          message: "Invalid or expired token",
        });
      } else if (member.passwordHash != null && (companyMember.invitation == "not_sent" || companyMember.invitation == "sent")) {
        return res.status(200).json({
          success: true,
          message: "Token is Valid, show popup",
          isPassword: true
        });
      }
      return res.status(200).json({
        success: true,
        message: "Token is Valid",
        isPassword: false
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
  public updateInvitationStatus = async (req: Request<{}, {}, { token: string, status: boolean }>,
    res: Response
  ) => {

    try {
      const { token, status } = req.body;

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
      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

      const companyMember = await companyMemberRepo.findOne({
        where: {
          member: { id: decoded.memberId },
          company: { id: decoded.companyId },
        }
      })
      if (!companyMember) {
        return res.status(404).json({
          success: false,
          message: "Invitation not found"
        });
      }
      if (status) {
        companyMember.invitation = "accepted";
      } else {
        companyMember.invitation = "rejected";
      }
      await companyMemberRepo.save(companyMember);

      const updatedMember = await memberRepo.findOne({
        where: { id: decoded.memberId },
        relations: ['companyMembers', 'companyMembers.company', 'companyMembers.role'],
      });

      if (!updatedMember) {
        return res.status(404).json({
          success: false,
          message: "Member not found after update"
        });
      }


      const acceptedCompanyMembers = updatedMember.companyMembers.filter(cm => cm.invitation === 'accepted');


      const primaryCompanyMember = acceptedCompanyMembers[0];
      const primaryCompany = primaryCompanyMember.company;
      const companyId = primaryCompany?.id ?? null;

      const associatedCompanies = updatedMember.companyMembers.map((cm) => ({
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
          memberId: updatedMember.id,
          companyId: companyId,
          isAdmin: primaryCompanyMember.isAdmin,
          companyMemberId: primaryCompanyMember.id
        },
        process.env.JWT_SECRET!,
        { expiresIn: "1d" }
      );

      // Build unified user response
      const userData = {
        id: updatedMember.id,
        name: primaryCompanyMember.name,
        email: updatedMember.email,
        role: primaryCompanyMember.role ? primaryCompanyMember.role.name : null,
        roleId: primaryCompanyMember.role ? primaryCompanyMember.role.id : null,
        isAdmin: primaryCompanyMember.isAdmin,
        location: primaryCompanyMember.location ?? null,
        profilePhoto: primaryCompanyMember.profilePhoto ?? null,
        phone: primaryCompanyMember.phone ?? null,
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

      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

      const companyMember = await companyMemberRepo.findOne({
        where: {
          member: { id: decoded.memberId },
          company: { id: decoded.companyId },
        }
      })
      if (!companyMember) {
        return res.status(404).json({
          success: false,
          message: "Invitation not found"
        });
      }
      companyMember.invitation = "accepted";
      await companyMemberRepo.save(companyMember);
      const updatedMember = await memberRepo.findOne({
        where: { id: decoded.memberId },
        relations: ['companyMembers', 'companyMembers.company', 'companyMembers.role'],
      });

      if (!updatedMember) {
        return res.status(404).json({
          success: false,
          message: "Member not found after update"
        });
      }


      const acceptedCompanyMembers = updatedMember.companyMembers.filter(cm => cm.invitation === 'accepted');
      const primaryCompanyMember = acceptedCompanyMembers[0];
      const primaryCompany = primaryCompanyMember.company;
      const companyId = primaryCompany?.id ?? null;

      const associatedCompanies = updatedMember.companyMembers.map((cm) => ({
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
          memberId: updatedMember.id,
          companyId: companyId,
          isAdmin: primaryCompanyMember.isAdmin,
          companyMemberId: primaryCompanyMember.id
        },
        process.env.JWT_SECRET!,
        { expiresIn: "1d" }
      );

      // Build unified user response
      const userData = {
        id: updatedMember.id,
        name: primaryCompanyMember.name,
        email: updatedMember.email,
        role: primaryCompanyMember.role ? primaryCompanyMember.role.name : null,
        roleId: primaryCompanyMember.role ? primaryCompanyMember.role.id : null,
        isAdmin: primaryCompanyMember.isAdmin,
        location: primaryCompanyMember.location ?? null,
        profilePhoto: primaryCompanyMember.profilePhoto ?? null,
        phone: primaryCompanyMember.phone ?? null,
        company: {
          id: companyId,
          logo: primaryCompany?.logo ?? null,
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
    const eventAssignmentRepo = AppDataSource.getRepository(EventAssignment);

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
      startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      endDate = `${year}-${month.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;
    } else {
      const weekStart = this.getDateFromWeek(year, week);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      startDate = this.formatDate(weekStart);
      endDate = this.formatDate(weekEnd);
    }
    let allLockedDates: string[] = [];
    
    if (company.lockedDates && company.lockedDates.length > 0) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      allLockedDates = company.lockedDates.filter(lockedDateStr => {
        const lockedDate = new Date(lockedDateStr);
        return lockedDate >= start && lockedDate <= end;
      });
      
    }

    // First, get all company members (regardless of assignments)
    const companyMembersQuery = companyMemberRepo.createQueryBuilder('companyMember')
      .leftJoinAndSelect('companyMember.member', 'member')
      .leftJoinAndSelect('member.googleTokens', 'googleTokens')
      .leftJoinAndSelect('companyMember.role', 'role')
      .where('companyMember.companyId = :companyId', { companyId });

    // If memberId is provided, filter for that specific member
    // if (memberId) {
    //     companyMembersQuery.andWhere('member.id = :memberId', { memberId });
    // }

    const companyMembers = await companyMembersQuery
      .orderBy('companyMember.name', 'ASC')
      .getMany();

    // If memberId was provided but no member found, return error
    if (memberId && companyMembers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found in this company"
      });
    }

    // Get event assignments for the date range to populate events for members
    const eventAssignmentsQuery = eventAssignmentRepo.createQueryBuilder('eventAssignment')
      .leftJoinAndSelect('eventAssignment.member', 'member')
      .leftJoinAndSelect('eventAssignment.events', 'events')
      .leftJoinAndSelect('eventAssignment.role', 'role')
      .leftJoinAndSelect('events.project', 'project')
      .leftJoinAndSelect('project.company', 'projectCompany')
      .where('events.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('member.id IN (:...memberIds)', {
        memberIds: companyMembers.map(cm => cm.member.id)
      });

    const eventAssignments = await eventAssignmentsQuery
      .orderBy('events.date', 'ASC')
      .addOrderBy('events.startHour', 'ASC')
      .getMany();

    // Group event assignments by member ID for easy lookup
    const assignmentsByMember = new Map();
    eventAssignments.forEach(assignment => {
      const memberId = assignment.member.id;
      if (!assignmentsByMember.has(memberId)) {
        assignmentsByMember.set(memberId, []);
      }
      assignmentsByMember.get(memberId).push(assignment);
    });

    // ============ GOOGLE CALENDAR EVENTS FETCHING ============

      // Fetch Google Calendar events for all members in parallel
      const googleCalendarPromises = companyMembers.map(async (companyMember) => {
        try {
          const member = companyMember.member;

          // Check if member has active Google tokens
          const hasActiveToken = member.googleTokens?.some(token => token.isActive);

          if (!hasActiveToken) {
            return { memberId: member.id, events: [] };
          }

          // Convert date range for Google Calendar API (ISO format with time)
          const timeMin = new Date(startDate + 'T00:00:00').toISOString();
          const timeMax = new Date(endDate + 'T23:59:59.999Z').toISOString();

          // Get authenticated client using your existing service
          const authClient = await GoogleCalendarService.getAuthenticatedClient(member.id);
          const calendarClient = calendar({ version: 'v3', auth: authClient });

          // Fetch events from Google Calendar
          const response = await calendarClient.events.list({
            calendarId: 'primary',
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250 // Adjust based on your needs
          });

          const googleEvents = response.data.items || [];

          // FILTER: Exclude events that came from our system
          const filteredGoogleEvents = googleEvents.filter(event => {
            // Option 1: Check if it has our system's extended properties
            const isFromOurSystem = event.extendedProperties?.private?.source === 'Weddex-Sync';



            // Option 3: Check description/summary for our keywords
            const description = event.description || '';
            const summary = event.summary || '';
            const hasOurKeywords = ['Weddex', 'Event synced from', 'Project:', 'Client:'].some(keyword =>
              description.includes(keyword) || summary.includes(keyword)
            );

            // Skip if any of these conditions are true
            if (isFromOurSystem || hasOurKeywords) {
              console.log(`Skipping Google Calendar event ${event.id} - from our system`);
              return false;
            }

            return true;
          });

          console.log(`Member ${member.id}: Found ${googleEvents.length} Google events, filtered to ${filteredGoogleEvents.length} external events`);

          // Format Google Calendar events to match your structure
          const formattedEvents = filteredGoogleEvents.map(event => {
            // Extract date and hours from Google Calendar event
            const isAllDay = !event.start?.dateTime;
            const eventStart = event.start?.dateTime ? new Date(event.start.dateTime) :
              (event.start?.date ? new Date(event.start.date) : new Date(startDate));
            const eventEnd = event.end?.dateTime ? new Date(event.end.dateTime) :
              (event.end?.date ? new Date(event.end.date) : new Date(startDate));

            // For all-day events, Google uses date-only format
            // For multi-day events, we need to handle them as single events
            const eventDate = isAllDay ?
              (event.start?.date || startDate) :
              eventStart.toISOString().split('T')[0];

            // Calculate duration in days for multi-day events
            const durationMs = eventEnd.getTime() - eventStart.getTime();
            const durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24));
            const isMultiDay = durationDays > 1;

            // ============ CORRECTED HOURLY CONVERSION LOGIC ============
            let startHour = null;
            let startMinute = null;
            let endHour = null;
            let endMinute = null;
            let durationInHours = null;

            if (!isAllDay) {
              // Get exact hours and minutes
              const exactStartHour = eventStart.getHours();
              const exactStartMinute = eventStart.getMinutes();
              const exactEndHour = eventEnd.getHours();
              const exactEndMinute = eventEnd.getMinutes();

              // Apply CORRECTED rounding rules:
              // Start time: FLOOR (round down to current hour)
              startHour = exactStartHour; // Always floor to current hour
              startMinute = 0;

              // End time: CEILING (round up to next hour if there are minutes)
              endHour = exactEndMinute > 0 ? exactEndHour + 1 : exactEndHour;
              endMinute = 0;

              // Edge case: if endHour rounds up to 24, handle it
              if (endHour >= 24) {
                endHour = 23;
                endMinute = 59;

                // If this makes endHour < startHour, adjust
                if (endHour < startHour && eventDate === eventEnd.toISOString().split('T')[0]) {
                  endHour = 23;
                }
              }

              // Calculate duration in hours (using rounded hours)
              if (eventDate === eventEnd.toISOString().split('T')[0]) {
                // Same day event
                durationInHours = Math.max(1, endHour - startHour);
              } else {
                // Multi-day event - calculate total hours across days
                // For first day: 24 - startHour
                // For full days in between: 24 * (full days)
                // For last day: endHour
                const firstDayHours = 24 - startHour;
                const lastDayHours = endHour;
                const fullDaysBetween = durationDays - 2; // Excluding first and last day
                const middleDaysHours = fullDaysBetween > 0 ? fullDaysBetween * 24 : 0;

                durationInHours = firstDayHours + middleDaysHours + lastDayHours;
              }

              // Special case: If event duration after rounding is 0, make it at least 1 hour
              if (durationInHours < 1) {
                durationInHours = 1;
                if (endHour === startHour) {
                  endHour = startHour + 1;
                }
              }
            }
            // ============ END CORRECTED HOURLY CONVERSION ============

            return {
              id: event.id,
              name: event.summary || 'No Title',
              date: eventDate, // Start date
              endDate: isMultiDay ? eventEnd.toISOString().split('T')[0] : null, // End date for multi-day events
              startHour: startHour, // FLOORED to current hour
              startMinute: startMinute, // Always 0
              endHour: endHour, // CEILING to next hour
              endMinute: endMinute, // Always 0
              location: event.location || '',
              isGoogleCalendarEvent: true, // Flag to identify Google Calendar events
              source: 'google_calendar',
              htmlLink: event.htmlLink,
              description: event.description || '',
              allDay: isAllDay,
              multiDay: isMultiDay, // Flag to indicate multi-day event
              durationDays: isMultiDay ? durationDays : null,
              durationHours: durationInHours, // Added for clarity
              originalStartTime: !isAllDay ? eventStart.toISOString() : null, // Keep original for reference
              originalEndTime: !isAllDay ? eventEnd.toISOString() : null, // Keep original for reference
              roundedStartTime: startHour !== null ? `${startHour.toString().padStart(2, '0')}:00` : null,
              roundedEndTime: endHour !== null ? `${endHour.toString().padStart(2, '0')}:00` : null,
              organizer: event.organizer?.email,
              attendees: event.attendees?.map((a: any) => ({
                email: a.email,
                displayName: a.displayName,
                responseStatus: a.responseStatus
              })) || [],
              // Add extended properties if available
              extendedProperties: event.extendedProperties,
              // These won't exist for Google Calendar events
              project: null,
              assignment: null,
              reminders: null,
              isOther: false
            };
          });

          return { memberId: member.id, events: formattedEvents };

        } catch (error) {
          console.error(`Error fetching Google Calendar events for member ${companyMember.member.id}:`, error);

          // Handle specific Google Calendar errors
          if (error.code === 401 || error.message?.includes('invalid_grant')) {
            console.log(`Google authentication expired for member ${companyMember.member.id}`);
            // Optionally mark the token as inactive
            if (companyMember.member.googleTokens) {
              companyMember.member.googleTokens.forEach(token => {
                if (token.isActive) token.isActive = false;
              });
            }
          }

          return { memberId: companyMember.member.id, events: [] };
        }
      });

      // Wait for all Google Calendar requests to complete
      const googleCalendarResults = await Promise.allSettled(googleCalendarPromises);

      // Create a map of Google Calendar events by member ID
      const googleEventsByMember = new Map();
      googleCalendarResults.forEach(result => {
        if (result.status === 'fulfilled') {
          googleEventsByMember.set(result.value.memberId, result.value.events);
        }
      });
    // ============ END GOOGLE CALENDAR FETCHING ============

    // Build the response with all company members, including those with no assignments
    const membersResponse = companyMembers.map(companyMember => {
      const member = companyMember.member;
      const isInvited = !member.passwordHash || member.passwordHash === '';

      // Get project events for this member from the assignments
      const memberAssignments = assignmentsByMember.get(member.id) || [];
      const projectEvents = memberAssignments.map(eventAssignment => ({
          eventId: eventAssignment.events.id,
          name: eventAssignment.events.name,
          date: eventAssignment.events.date,
          startHour: eventAssignment.events.startHour,
          endHour: eventAssignment.events.endHour,
          location: eventAssignment.events.location,
          reminders: eventAssignment.events.reminders,
          isOther: eventAssignment.events.project.company?.id !== companyId,
          isGoogleCalendarEvent: false, // Explicitly mark as not Google Calendar
          source: 'project',
          project: {
            id: eventAssignment.events.project.id,
            name: eventAssignment.events.project.name,
            color: eventAssignment.events.project.color,
            description: eventAssignment.events.project.description,
            client: eventAssignment.events.project.client,
            brief: eventAssignment.events.project.brief,
            logistics: eventAssignment.events.project.logistics,
            company: eventAssignment.events.project.company ? {
              id: eventAssignment.events.project.company.id,
              name: eventAssignment.events.project.company.name
            } : null
          },
          assignment: {
            id: eventAssignment.id,
            role: eventAssignment.role?.name || "",
            roleId: eventAssignment.role?.id || "",
            instructions: eventAssignment.instructions,
            googleEventId: eventAssignment.googleEventId
          }
      }));

      // Get Google Calendar events for this member
      const googleCalendarEvents = googleEventsByMember.get(member.id) || [];

      // Check if member has active Google Calendar connection
      const hasGoogleCalendar = member.googleTokens?.some(token => token.isActive) || false;

      return {
        id: member.id,
        name: companyMember.name,
        email: member.email,
        role: companyMember.role?.name || 'No Role Assigned',
        roleId: companyMember.role?.id || "",
        phone: companyMember.phone || '',
        location: companyMember.location || '',
        bio: companyMember.bio || '',
        profilePhoto: companyMember.profilePhoto || '',
        ringColor: companyMember.ringColor || '',
        active: companyMember.active,
        isAdmin: companyMember.isAdmin,
        skills: companyMember.skills || [],
        companyId: companyId,
        companyMemberId: companyMember.id,
        isInvited: isInvited,
        isOwner: company.email === member.email,
        invitation: companyMember.invitation,
        events: projectEvents,
        googleCalendarEvents: googleCalendarEvents,
        hasGoogleCalendar: hasGoogleCalendar,
        totalEvents: projectEvents.length + googleCalendarEvents.length
      };
    });

    // Sort members: admins first, then by name
    let sortedMembersResponse = [...membersResponse].sort((a, b) => {
      if (a.isAdmin && !b.isAdmin) return -1;
      if (!a.isAdmin && b.isAdmin) return 1;
      return a.name.localeCompare(b.name);
    });

    // If memberId is provided, sort to put that member first
    if (memberId) {
      sortedMembersResponse = sortedMembersResponse.sort((a, b) => {
        if (a.id === memberId) return -1;
        if (b.id === memberId) return 1;
        if (a.isAdmin && !b.isAdmin) return -1;
        if (!a.isAdmin && b.isAdmin) return 1;
        return a.name.localeCompare(b.name);
      });
    }

    // Calculate summary statistics
    const totalProjectEvents = sortedMembersResponse.reduce((sum, member) => sum + member.events.length, 0);
    const totalGoogleEvents = sortedMembersResponse.reduce((sum, member) => sum + member.googleCalendarEvents.length, 0);
    const totalEvents = totalProjectEvents + totalGoogleEvents;

    // Prepare response metadata
    const responseMetadata = viewType === 'month'
      ? { month, year }
      : { week, year };

    return res.status(200).json({
      success: true,
      message: memberId
        ? `Member details retrieved successfully for ${viewType} view`
        : `Members retrieved successfully for ${viewType} view`,
      members: sortedMembersResponse,
      totalCount: sortedMembersResponse.length,
      totalProjectEvents,
      totalGoogleEvents,
      totalEvents,
      viewType,
      ...responseMetadata,
      dateRange: {
        startDate,
        endDate
      },
      lockedDates: allLockedDates
    });

  } catch (err) {
    console.error("Error fetching members:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching members"
    });
  }
};

  // Helper function to check if two date ranges overlap
  private datesOverlap(start1: Date, end1: Date | null, start2: Date, end2: Date): boolean {
    if (!start1 || !start2) return false;

    // If event has no end date, treat it as single day at start date
    const actualEnd1 = end1 || new Date(start1);
    // Make sure end1 is at end of day if it's the same as start1
    if (actualEnd1.getTime() === start1.getTime()) {
      actualEnd1.setHours(23, 59, 59, 999);
    }

    console.log(`  Overlap check:`);
    console.log(`    Range 1: ${start1.toISOString()} to ${actualEnd1.toISOString()}`);
    console.log(`    Range 2: ${start2.toISOString()} to ${end2.toISOString()}`);

    // Check for overlap: (StartA <= EndB) and (EndA >= StartB)
    const overlaps = start1 <= end2 && actualEnd1 >= start2;
    console.log(`    Result: ${overlaps}`);

    return overlaps;
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getDateFromWeek(year: number, week: number): Date {
    // Simple implementation - adjust as needed
    const date = new Date(year, 0, 1 + (week - 1) * 7);
    const dayOfWeek = date.getDay();
    date.setDate(date.getDate() - dayOfWeek + 1); // Start on Monday
    return date;
  }


  public getMembersWithCurrentFutureProjects = async (
    req: Request<{}, {}, IGetMembersWithProjectsRequest>,
    res: Response<any>
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
      const eventAssignmentRepo = AppDataSource.getRepository(EventAssignment);

      const company = await companyRepo.findOneBy({ id: companyId });
      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found"
        });
      }

      // Get current date in YYYY-MM-DD format
      const currentDate = new Date().toISOString().split('T')[0];

      // Build query for event assignments with current and future events
      const queryBuilder = eventAssignmentRepo.createQueryBuilder('eventAssignment')
        .leftJoinAndSelect('eventAssignment.member', 'member')
        .leftJoinAndSelect('eventAssignment.events', 'events')
        .leftJoinAndSelect('eventAssignment.role', 'role')
        .leftJoinAndSelect('events.project', 'project')
        .leftJoinAndSelect('project.company', 'projectCompany') // Add project company relation
        .leftJoinAndSelect('member.companyMembers', 'companyMembers')
        .leftJoinAndSelect('companyMembers.company', 'company')
        .leftJoinAndSelect('companyMembers.role', 'companyMemberRole')
        .where('company.id = :companyId', { companyId })
        .andWhere('events.date >= :currentDate', { currentDate });

      // If memberId is provided, filter for that specific member
      if (memberId) {
        queryBuilder.andWhere('member.id = :memberId', { memberId });
      }

      const eventAssignments = await queryBuilder
        .orderBy('events.date', 'ASC')
        .addOrderBy('events.startHour', 'ASC')
        .getMany();

      // Group event assignments by member
      const membersMap = new Map();

      eventAssignments.forEach(eventAssignment => {
        const member = eventAssignment.member;
        const companyMember = member.companyMembers?.find(cm => cm.company.id === companyId);

        if (!membersMap.has(member.id)) {
          const isInvited = !member.passwordHash || member.passwordHash === '';

          membersMap.set(member.id, {
            id: member.id,
            name: companyMember?.name || member.email,
            email: member.email,
            role: companyMember?.role?.name || 'No Role Assigned',
            roleId: companyMember?.role?.id || "",
            phone: companyMember?.phone || '',
            location: companyMember?.location || '',
            bio: companyMember?.bio || '',
            profilePhoto: companyMember?.profilePhoto || '',
            ringColor: companyMember?.ringColor || '',
            active: companyMember?.active ?? true,
            isAdmin: companyMember?.isAdmin ?? false,
            skills: companyMember?.skills || [],
            companyId: companyId,
            companyMemberId: companyMember?.id,
            isInvited: isInvited,
            isOwner: company.email === member.email,
            invitation: companyMember?.invitation,
            events: []
          });
        }

        const memberData = membersMap.get(member.id);

        // Determine event status
        let status: 'current' | 'upcoming' = 'upcoming';
        if (eventAssignment.events.date === currentDate) {
          status = 'current';
        }

        // Check if project is from other company
        const isOther = eventAssignment.events.project.company?.id !== companyId;

        memberData.events.push({
          eventId: eventAssignment.events.id,
          name: eventAssignment.events.name,
          date: eventAssignment.events.date,
          startHour: eventAssignment.events.startHour,
          endHour: eventAssignment.events.endHour,
          location: eventAssignment.events.location,
          reminders: eventAssignment.events.reminders,
          status: status,
          isOther: isOther, // Add isOther field
          project: {
            id: eventAssignment.events.project.id,
            name: eventAssignment.events.project.name,
            color: eventAssignment.events.project.color,
            description: eventAssignment.events.project.description,
            client: eventAssignment.events.project.client,
            brief: eventAssignment.events.project.brief,
            logistics: eventAssignment.events.project.logistics,
            // Optionally include company info if needed
            company: eventAssignment.events.project.company ? {
              id: eventAssignment.events.project.company.id,
              name: eventAssignment.events.project.company.name
            } : null
          },
          assignment: {
            id: eventAssignment.id,
            role: eventAssignment.role?.name || "",
            roleId: eventAssignment.role?.id || "",
            instructions: eventAssignment.instructions,
            googleEventId: eventAssignment.googleEventId
          }
        });
      });

      const membersResponse = Array.from(membersMap.values());

      // Calculate summary statistics based on events
      const totalMembers = membersResponse.length;
      let totalEvents = 0;
      let currentEvents = 0;
      let upcomingEvents = 0;
      let otherCompanyEvents = 0;

      membersResponse.forEach(member => {
        member.events.forEach((event: any) => {
          totalEvents++;
          if (event.status === 'current') {
            currentEvents++;
          } else {
            upcomingEvents++;
          }
          if (event.isOther) {
            otherCompanyEvents++;
          }
        });
      });

      return res.status(200).json({
        success: true,
        message: memberId
          ? `Member with current and future events retrieved successfully`
          : `Members with current and future events retrieved successfully`,
        members: membersResponse,
        totalCount: totalMembers,
        summary: {
          totalEvents,
          currentEvents,
          upcomingEvents,
          otherCompanyEvents,
          ownCompanyEvents: totalEvents - otherCompanyEvents,
          asOfDate: currentDate
        }
      });

    } catch (err) {
      console.error("Error fetching members with events:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while fetching members with events"
      });
    }
  };


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
      if (name !== undefined) companyMember.name = name;
      if (email !== undefined) member.email = email;
      if (phone !== undefined) companyMember.phone = phone;
      if (location !== undefined) companyMember.location = location;
      if (bio !== undefined) companyMember.bio = bio;
      if (skills !== undefined) companyMember.skills = skillsArray;
      if (profilePhoto !== undefined) companyMember.profilePhoto = profilePhoto;
      if (ringColor !== undefined) companyMember.ringColor = ringColor;

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
      const { memberId, companyId } = req.body;
      const file = (req as any).file;

      // Validation
      if (!memberId || !companyId) {
        return res.status(400).json({
          success: false,
          message: "Member ID and Company ID are required"
        });
      }

      if (!file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded"
        });
      }

      // Validate file type
      const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: "Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed"
        });
      }

      // Validate file size (e.g., 5MB max)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        return res.status(400).json({
          success: false,
          message: "File size too large. Maximum size is 5MB"
        });
      }

      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

      // Find the company member relationship
      const companyMember = await companyMemberRepo.findOne({
        where: {
          member: { id: memberId },
          company: { id: companyId }
        },
        relations: ["member", "company"]
      });

      if (!companyMember) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this company"
        });
      }

      // Delete old profile photo if exists
      if (companyMember.profilePhoto) {
        await this.deleteProfilePhotoFromS3(companyMember.profilePhoto);
      }

      if (!file.s3Key) {
        console.error('No s3Key found in file object');
        return res.status(500).json({
          success: false,
          message: "Failed to upload profile photo - no s3Key"
        });
      }

      // Update company member profile photo
      companyMember.profilePhoto = file.s3Key;
      companyMember.updatedAt = new Date();

      await companyMemberRepo.save(companyMember);

      return res.status(200).json({
        success: true,
        message: "Profile photo uploaded successfully",
        profilePhotoPath: file.s3Key,
        companyMember: {
          id: companyMember.id,
          profilePhoto: file.s3Key,
          memberId: companyMember.member.id,
          companyId: companyMember.company.id
        }
      });

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

      // Validation
      if (!memberId) {
        return res.status(400).json({
          success: false,
          message: "Member ID is required"
        });
      }

      if (!companyId) {
        return res.status(400).json({
          success: false,
          message: "Company ID is required"
        });
      }

      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

      // Find the company member relationship
      const companyMember = await companyMemberRepo.findOne({
        where: {
          member: { id: memberId },
          company: { id: companyId }
        },
        relations: ["member", "company"]
      });

      if (!companyMember) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this company"
        });
      }

      // Check if company member has a profile photo
      if (!companyMember.profilePhoto) {
        return res.status(400).json({
          success: false,
          message: "Member does not have a profile photo to remove"
        });
      }

      // Delete from S3
      await this.deleteProfilePhotoFromS3(companyMember.profilePhoto);

      // Update company member record
      companyMember.profilePhoto = null;
      companyMember.updatedAt = new Date();

      const updatedCompanyMember = await companyMemberRepo.save(companyMember);

      return res.status(200).json({
        success: true,
        message: "Profile photo removed successfully",
        companyMember: {
          id: updatedCompanyMember.id,
          profilePhoto: updatedCompanyMember.profilePhoto,
          memberId: updatedCompanyMember.member.id,
          companyId: updatedCompanyMember.company.id,
          updatedAt: updatedCompanyMember.updatedAt
        }
      });

    } catch (err) {
      console.error("Error removing profile photo:", err);
      return res.status(500).json({
        success: false,
        message: "Server error while removing profile photo"
      });
    }
  };

  private async deleteProfilePhotoFromS3(profilePhotoKey: string): Promise<void> {
    const bucketName = process.env.AWS_S3_BUCKET_NAME;

    if (!bucketName) {
      console.error("AWS_S3_BUCKET_NAME environment variable is not set");
      return;
    }

    if (!profilePhotoKey) {
      console.warn("No profile photo key provided for deletion");
      return;
    }

    try {
      const deleteResult = await deleteFromS3(bucketName, profilePhotoKey);

      if (!deleteResult.success) {
        console.error("Failed to delete file from S3:", deleteResult.error);
        // Don't throw error here - we still want to update the database
      }
    } catch (s3Error) {
      console.error("Error deleting file from S3:", s3Error);
      // Don't throw error here - we still want to update the database
    }
  }
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

      const activeCompanyMembers = member.companyMembers.filter(
        cm => cm.invitation == 'accepted'
      );

      if (activeCompanyMembers.length === 0) {
        return res.status(403).json({
          success: false,
          message: "Member is not associated with any company"
        });
      }

      // ✅ Find company where company email matches member email
      const emailMatchCompanyMember = activeCompanyMembers.find(
        (cm) => cm.company.email.toLowerCase() === lowerCaseEmail
      );

      // ✅ Use email-matched company if found, otherwise use first company
      const primaryCompanyMember = emailMatchCompanyMember || activeCompanyMembers[0];
      const primaryCompany = primaryCompanyMember.company;
      const companyId = primaryCompany?.id ?? null;

      const associatedCompanies = activeCompanyMembers.map((cm) => ({
        id: cm.company.id,
        name: cm.company.name,
        email: cm.company.email,
        country: cm.company.country,
        isAdmin: cm.isAdmin,
        isEmailMatch: cm.company.email.toLowerCase() === lowerCaseEmail
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
        name: primaryCompanyMember.name,
        email: member.email,
        role: primaryCompanyMember.role ? primaryCompanyMember.role.name : null,
        roleId: primaryCompanyMember.role ? primaryCompanyMember.role.id : null,
        isAdmin: primaryCompanyMember.isAdmin,
        location: primaryCompanyMember.location ?? null,
        profilePhoto: primaryCompanyMember.profilePhoto ?? null,
        phone: primaryCompanyMember.phone ?? null,
        company: {
          id: companyId,
          logo: primaryCompany?.logo ?? null,
          name: primaryCompany?.name ?? null,
          email: primaryCompany?.email ?? null,
          country: primaryCompany?.country ?? null,
        },
        associatedCompanies,
        companyMemberId: primaryCompanyMember.id
      };

      return res.status(200).json({
        success: true,
        message: emailMatchCompanyMember
          ? "Login successful - Auto-selected company with matching email"
          : "Login successful",
        token,
        user: userData,
        autoSelected: !!emailMatchCompanyMember
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
      const { companyId, eventDate, startHour, endHour, excludeEventId } = req.body;

      // Validation - if any required parameter is null, return all members
      if (
        !companyId ||
        !eventDate ||
        startHour === undefined ||
        startHour === null ||
        endHour === undefined ||
        endHour === null
      ) {
        // Fetch company to verify it exists
        const companyRepo = AppDataSource.getRepository(Company);
        const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

        const company = await companyRepo.findOneBy({ id: companyId });
        if (!company) {
          return res.status(404).json({
            success: false,
            message: "Company not found",
          });
        }

        // Fetch all active company members without filtering
        const companyMembers = await companyMemberRepo.find({
          where: {
            company: { id: companyId },
            active: true
          },
          relations: [
            "member",
            "member.googleTokens", // ADD THIS: Load Google tokens
            "member.eventAssignments",
            "member.eventAssignments.role",
            "member.eventAssignments.events",
            "member.eventAssignments.events.project",
            "role"
          ],
          select: {
            id: true,
            name: true,
            phone: true,
            profilePhoto: true,
            location: true,
            bio: true,
            skills: true,
            ringColor: true,
            isAdmin: true,
            active: true,
            role: {
              id: true,
              name: true
            },
            member: {
              id: true,
              email: true,
              active: true,
              eventAssignments: {
                id: true,
                role: {
                  id: true,
                  name: true
                },
                events: {
                  id: true,
                  date: true,
                  startHour: true,
                  endHour: true,
                  location: true,
                  project: {
                    id: true,
                    name: true,
                    color: true,
                    description: true
                  }
                }
              },
              // ADD THIS: Include googleTokens in select
              googleTokens: {
                id: true,
                isActive: true,
                refreshToken: true
              }
            },
          },
        });

        // Transform all members as fully available
        const allMembers: IAvailableMemberResponse[] = companyMembers.map(companyMember => ({
          id: companyMember.member.id,
          profilePhoto: companyMember.profilePhoto,
          name: companyMember.name,
          email: companyMember.member.email,
          role: companyMember.role?.name || "",
          roleId: companyMember.role?.id || "",
          phone: companyMember.phone || "",
          location: companyMember.location || "",
          bio: companyMember.bio || "",
          skills: companyMember.skills || [],
          ringColor: companyMember.ringColor || "",
          isAdmin: companyMember.isAdmin,
          companyMemberId: companyMember.id,
          availabilityStatus: "fully_available",
          conflicts: [],
          hasGoogleCalendar: companyMember.member.googleTokens?.some(token => token.isActive) || false // Add this
        }));

        return res.status(200).json({
          success: true,
          message: "All company members retrieved (no date/time filters applied)",
          data: {
            availableMembers: allMembers,
            totalFullyAvailable: allMembers.length,
            totalPartiallyAvailable: 0,
            totalUnavailable: 0,
            totalMembers: companyMembers.length,
            dateRange: null,
            note: "No date/time filters were applied - all members returned as fully available"
          },
        });
      }

      // Validate date format (only if all parameters are provided)
      const eventDateTime = new Date(eventDate);

      if (isNaN(eventDateTime.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use yyyy-mm-dd",
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

      const company = await companyRepo.findOneBy({ id: companyId });
      if (!company) {
        return res.status(404).json({
          success: false,
          message: "Company not found",
        });
      }

      // Fetch company members with event assignments and events
      const companyMembers = await companyMemberRepo.find({
        where: {
          company: { id: companyId },
          active: true // Only include active company members
        },
        relations: [
          "member",
          "member.googleTokens", // ADD THIS: Load Google tokens
          "member.eventAssignments",
          "member.eventAssignments.role",
          "member.eventAssignments.events",
          "member.eventAssignments.events.project",
          "role"
        ],
        select: {
          id: true,
          name: true,
          phone: true,
          profilePhoto: true,
          location: true,
          bio: true,
          skills: true,
          ringColor: true,
          isAdmin: true,
          active: true,
          role: {
            id: true,
            name: true
          },
          member: {
            id: true,
            email: true,
            active: true,
            eventAssignments: {
              id: true,
              role: {
                id: true,
                name: true
              },
              events: {
                id: true,
                date: true,
                startHour: true,
                endHour: true,
                location: true,
                project: {
                  id: true,
                  name: true,
                  color: true,
                  description: true
                }
              }
            },
            // ADD THIS: Include googleTokens in select
            googleTokens: {
              id: true,
              isActive: true,
              refreshToken: true
            }
          },
        },
      });

      // Helper method to check Google Calendar conflicts
      const checkGoogleCalendarConflicts = async (member: Member, eventDate: string, startHour: number, endHour: number): Promise<any[]> => {
        try {
          // Check if member has active Google Calendar connection
          const hasActiveToken = member.googleTokens?.some(token => token.isActive && token.refreshToken);

          if (!hasActiveToken) {
            return []; // No Google Calendar connection
          }

          // Convert date/time to Google Calendar API format
          const eventDateTime = new Date(eventDate);

          // Create timeMin and timeMax for the exact hours requested
          const timeMin = new Date(eventDateTime);
          timeMin.setHours(startHour, 0, 0, 0);

          const timeMax = new Date(eventDateTime);
          timeMax.setHours(endHour, 0, 0, 0);

          // Get Google Calendar events for this member
          const authClient = await GoogleCalendarService.getAuthenticatedClient(member.id);
          const calendarClient = calendar({ version: 'v3', auth: authClient });

          const response = await calendarClient.events.list({
            calendarId: 'primary',
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 50
          });

          const googleEvents = response.data.items || [];

          // Filter out events from our own system
          const externalEvents = googleEvents.filter(event => {
            // Skip if it's from our system
            const isFromOurSystem = event.extendedProperties?.private?.source === 'Weddex-Sync';
            const hasOurKeywords = ['Weddex', 'Event synced from'].some(keyword =>
              (event.description || '').includes(keyword) || (event.summary || '').includes(keyword)
            );
            return !(isFromOurSystem || hasOurKeywords);
          });

          // Convert Google Calendar events to conflicts
          const conflicts: any[] = [];

          externalEvents.forEach(event => {
            const isAllDay = !event.start?.dateTime;

            if (isAllDay) {
              // All-day event conflicts with entire day
              conflicts.push({
                projectId: null,
                projectName: "Google Calendar",
                eventDate: eventDate,
                startHour: 0,
                endHour: 24,
                conflictType: "google_calendar_all_day",
                eventId: event.id,
                eventName: event.summary || "Google Calendar Event",
                source: "google_calendar",
                description: "All-day event in Google Calendar"
              });
            } else {
              // Timed event - check if it overlaps with requested hours
              const eventStart = new Date(event.start.dateTime);
              const eventEnd = new Date(event.end.dateTime);

              const eventStartHour = eventStart.getHours();
              const eventEndHour = eventEnd.getHours();

              // Check if Google Calendar event overlaps with requested time
              const hasTimeOverlap = !(endHour <= eventStartHour || startHour >= eventEndHour);

              if (hasTimeOverlap) {
                conflicts.push({
                  projectId: null,
                  projectName: "Google Calendar",
                  eventDate: eventDate,
                  startHour: eventStartHour,
                  endHour: eventEndHour,
                  conflictType: "google_calendar_time",
                  eventId: event.id,
                  eventName: event.summary || "Google Calendar Event",
                  source: "google_calendar",
                  location: event.location || "",
                  description: event.description || "Busy in Google Calendar"
                });
              }
            }
          });

          return conflicts;

        } catch (error) {
          console.error(`Error checking Google Calendar for member ${member.id}:`, error);
          return []; // Return empty array on error
        }
      };

      // Helper methods to check conflicts (existing code)
      const hasDateConflict = (
        event: Events,
        requestedDate: string
      ): boolean => {
        const eventDateObj = new Date(event.date);
        const requestedDateObj = new Date(requestedDate);
        return eventDateObj.toDateString() === requestedDateObj.toDateString();
      };

      const hasHourConflict = (
        event: Events,
        startHour: number,
        endHour: number
      ): boolean => {
        return !(endHour <= event.startHour || startHour >= event.endHour);
      };

      const availableMembers: IAvailableMemberResponse[] = [];

      // Process each member
      for (const companyMember of companyMembers) {
        const member = companyMember.member;
        const conflicts: any[] = [];

        // 1. Check existing project event conflicts
        if (member.eventAssignments && member.eventAssignments.length > 0) {
          for (const assignment of member.eventAssignments) {
            const event = assignment.events;

            if (!event) continue;

            // Skip if this is the event we're excluding
            if (excludeEventId && event.id === excludeEventId) {
              continue;
            }

            const hasDateMatch = hasDateConflict(event, eventDate);

            if (hasDateMatch) {
              const hasHourConf = hasHourConflict(event, startHour, endHour);

              if (hasHourConf) {
                conflicts.push({
                  projectId: event.project?.id || "",
                  projectName: event.project?.name || "Unknown Project",
                  eventDate: event.date,
                  startHour: event.startHour,
                  endHour: event.endHour,
                  conflictType: "date_and_time",
                  eventId: event.id,
                  eventName: event.name,
                  source: "project"
                });
              } else {
                conflicts.push({
                  projectId: event.project?.id || "",
                  projectName: event.project?.name || "Unknown Project",
                  eventDate: event.date,
                  startHour: event.startHour,
                  endHour: event.endHour,
                  conflictType: "date_only",
                  eventId: event.id,
                  eventName: event.name,
                  source: "project"
                });
              }
            }
          }
        }

        // 2. Check Google Calendar conflicts (only if we have date/time parameters)
        const googleConflicts = await checkGoogleCalendarConflicts(member, eventDate, startHour, endHour);
        conflicts.push(...googleConflicts);

        // 3. Determine availability status
        const projectTimeConflicts = conflicts.filter(
          (c) => c.conflictType === "date_and_time" && c.source === "project"
        );

        const googleTimeConflicts = conflicts.filter(
          (c) => c.source === "google_calendar" &&
            (c.conflictType === "google_calendar_time" || c.conflictType === "google_calendar_all_day")
        );

        const dateOnlyConflicts = conflicts.filter(
          (c) => c.conflictType === "date_only"
        );

        // Combine all time conflicts (project + Google Calendar)
        const allTimeConflicts = [...projectTimeConflicts, ...googleTimeConflicts];

        if (allTimeConflicts.length === 0 && dateOnlyConflicts.length === 0) {
          availableMembers.push({
            id: member.id,
            profilePhoto: companyMember.profilePhoto,
            name: companyMember.name,
            email: member.email,
            role: companyMember.role?.name || "",
            roleId: companyMember.role?.id || "",
            phone: companyMember.phone || "",
            location: companyMember.location || "",
            bio: companyMember.bio || "",
            skills: companyMember.skills || [],
            ringColor: companyMember.ringColor || "",
            isAdmin: companyMember.isAdmin,
            companyMemberId: companyMember.id,
            availabilityStatus: "fully_available",
            conflicts: [],
            hasGoogleCalendar: member.googleTokens?.some(token => token.isActive) || false
          });
        } else if (allTimeConflicts.length === 0 && dateOnlyConflicts.length > 0) {
          availableMembers.push({
            id: member.id,
            profilePhoto: companyMember.profilePhoto,
            name: companyMember.name,
            email: member.email,
            role: companyMember.role?.name || "",
            roleId: companyMember.role?.id || "",
            phone: companyMember.phone || "",
            location: companyMember.location || "",
            bio: companyMember.bio || "",
            skills: companyMember.skills || [],
            ringColor: companyMember.ringColor || "",
            isAdmin: companyMember.isAdmin,
            companyMemberId: companyMember.id,
            availabilityStatus: "partially_available",
            conflicts: dateOnlyConflicts,
            hasGoogleCalendar: member.googleTokens?.some(token => token.isActive) || false
          });
        } else {
          availableMembers.push({
            id: member.id,
            profilePhoto: companyMember.profilePhoto,
            name: companyMember.name,
            email: member.email,
            role: companyMember.role?.name || "",
            roleId: companyMember.role?.id || "",
            phone: companyMember.phone || "",
            location: companyMember.location || "",
            bio: companyMember.bio || "",
            skills: companyMember.skills || [],
            ringColor: companyMember.ringColor || "",
            isAdmin: companyMember.isAdmin,
            companyMemberId: companyMember.id,
            availabilityStatus: "unavailable",
            conflicts: allTimeConflicts,
            hasGoogleCalendar: member.googleTokens?.some(token => token.isActive) || false
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
          eventDate,
          startHour,
          endHour,
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

      if (!companyId) {
        return res.status(400).json({
          success: false,
          message: "Company ID is required"
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

      const companyMemberRepo = AppDataSource.getRepository(CompanyMember);

      // Find company member relationship
      const companyMember = await companyMemberRepo.findOne({
        where: {
          member: { id: memberId },
          company: { id: companyId }
        },
        relations: ["member", "company"]
      });

      if (!companyMember) {
        return res.status(404).json({
          success: false,
          message: "Member not found in this company"
        });
      }

      // Update ring color (now company-specific)
      companyMember.ringColor = ringColor;
      companyMember.updatedAt = new Date();

      const updatedCompanyMember = await companyMemberRepo.save(companyMember);

      return res.status(200).json({
        success: true,
        message: "Ring color updated successfully",
        companyMember: {
          id: updatedCompanyMember.id,
          ringColor: updatedCompanyMember.ringColor,
          memberId: updatedCompanyMember.member.id,
          companyId: updatedCompanyMember.company.id,
          updatedAt: updatedCompanyMember.updatedAt
        }
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
