import { Request, Response } from "express";

import { IGetAllProjectsByMemberRequest, IGetAllProjectsByMemberResponse, IProjectAssignment } from "./types";
import { AppDataSource } from "../../config/data-source";
import { Member } from "../../entity/Member";
import { Company } from "../../entity/Company";
import GoogleCalendarService from "../../utils/GoogleCalendarService";
import { ProjectAssignment } from "../../entity/ProjectAssignment";

const memberRepo = AppDataSource.getRepository(Member);
const companyRepo = AppDataSource.getRepository(Company);

class GoogleCalendarController {
  // Initiate Google OAuth flow
  public initiateAuth = async (req: Request, res: Response) => {
    try {
      const memberId = req.body.memberId;
      
      if (!memberId) {
        return res.status(400).json({
          success: false,
          message: "Member ID is required"
        });
      }

      const authUrl = GoogleCalendarService.generateAuthUrl(memberId);
      
      return res.status(200).json({
        success: true,
        authUrl
      });
    } catch (error) {
      console.error('Error initiating auth:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to initiate Google authentication"
      });
    }
  };

  // Handle OAuth callback
  public handleCallback = async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      console.error('❌ Missing code or state parameters');
      return res.send(`
        <html>
          <body>
            <script>
              window.opener.postMessage({ 
                type: "GOOGLE_AUTH_ERROR", 
                success: false, 
                error: "Missing authentication parameters" 
              }, "*");
              window.close();
            </script>
          </body>
        </html>
      `);
    }

    const result = await GoogleCalendarService.handleCallback(
      code as string,
      state as string
    );

    if (result.success) {
      return res.send(`
        <html>
          <body>
            <script>
              window.opener.postMessage({ 
                type: "GOOGLE_AUTH_SUCCESS", 
                success: true, 
                message: "${result.message}" 
              }, "*");
              window.close();
            </script>
          </body>
        </html>
      `);
    } else {
      return res.send(`
        <html>
          <body>
            <script>
              window.opener.postMessage({ 
                type: "GOOGLE_AUTH_ERROR", 
                success: false, 
                error: "${result.message}" 
              }, "*");
              window.close();
            </script>
          </body>
        </html>
      `);
    }
  } catch (error: any) {
    console.error('💥 OAuth Callback Error:', error);
    return res.send(`
      <html>
        <body>
          <script>
            window.opener.postMessage({ 
              type: "GOOGLE_AUTH_ERROR", 
              success: false, 
              error: "${error.message || 'Authentication failed'}" 
            }, "*");
            window.close();
          </script>
        </body>
      </html>
    `);
  }
};


  // Check if user has Google auth
  public checkAuth = async (req: Request, res: Response) => {
    try {
      const memberId = req.body.memberId;
      
      if (!memberId) {
        return res.status(400).json({
          success: false,
          message: "Member ID is required"
        });
      }

      const hasAuth = await GoogleCalendarService.hasGoogleAuth(memberId);
      
      return res.status(200).json({
        success: true,
        hasAuth
      });
    } catch (error) {
      console.error('Error checking auth:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to check authentication status"
      });
    }
  };

  // Sync all projects to calendar
 public syncProjects = async (req: Request, res: Response) => {
    try {
      const memberId = req.body.memberId || res.locals.token?.memberId;
      const companyId = req.body.companyId || res.locals.token?.companyId;
      
      if (!memberId || !companyId) {
        return res.status(400).json({
          success: false,
          message: "Member ID and Company ID are required"
        });
      }

      // Check if member has Google auth
      const hasAuth = await GoogleCalendarService.hasGoogleAuth(memberId);
      if (!hasAuth) {
        return res.status(400).json({
          success: false,
          message: "Google Calendar not connected. Please connect first."
        });
      }

      // Get ProjectAssignment repository
      const assignmentRepo = AppDataSource.getRepository(ProjectAssignment);
      
      // Fetch assignments for this member in the company
      const assignments = await assignmentRepo.find({
        where: {
          member: { id: memberId },
          project: {
            company: { id: companyId }
          }
        },
        relations: [
          "project",
          "project.company",
          "member"
        ],
        order: {
          project: {
            startDate: "DESC"
          }
        }
      });

      if (assignments.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No project assignments found to sync",
          synced: 0,
          failed: 0
        });
      }

      // Sync each project assignment
      let synced = 0;
      let failed = 0;
      const results = [];

      for (const assignment of assignments) {
        try {
          const result = await GoogleCalendarService.syncProjectToCalendar(
            memberId, 
            assignment.project, // Pass the project from assignment
            assignment.id // Pass the assignmentId
          );

          if (result.success) {
            synced++;
          } else {
            failed++;
          }

          results.push({
            projectId: assignment.project.id,
            projectName: assignment.project.name,
            assignmentId: assignment.id,
            success: result.success,
            message: result.message,
            googleEventId: result.eventId,
            role: assignment.role
          });

        } catch (error: any) {
          failed++;
          results.push({
            projectId: assignment.project.id,
            projectName: assignment.project.name,
            assignmentId: assignment.id,
            success: false,
            message: error.message
          });
        }
      }

      return res.status(200).json({
        success: true,
        message: `Sync completed: ${synced} successful, ${failed} failed`,
        synced,
        failed,
        results
      });

    } catch (error: any) {
      console.error('Error syncing projects:', error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to sync projects"
      });
    }
  };

  // Disconnect Google Calendar
  public disconnect = async (req: Request, res: Response) => {
    try {
      const memberId = req.body.memberId || res.locals.token?.memberId;
      
      if (!memberId) {
        return res.status(400).json({
          success: false,
          message: "Member ID is required"
        });
      }

      const result = await GoogleCalendarService.disconnect(memberId);
      
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error disconnecting:', error);
      return res.status(500).json({
        success: false,
        message: "Failed to disconnect Google Calendar"
      });
    }
  };

  // Internal method to get member projects
  private async getMemberProjects(memberId: string, companyId: string): Promise<IProjectAssignment[]> {
    try {
      // Verify company exists
      const company = await companyRepo.findOneBy({ id: companyId });
      if (!company) {
        throw new Error("Company not found");
      }

      // Find member with assignments and projects
      const member = await memberRepo.findOne({
        where: {
          id: memberId,
          company: { id: companyId }
        },
        relations: [
          "assignments",
          "assignments.project"
        ],
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          assignments: {
            id: true,
            role: true,
            createdAt: true,
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
              logistics: true,
              createdAt: true
            }
          }
        }
      });

      if (!member) {
        throw new Error("Member not found in this company");
      }

      // Format the response
      const projects: IProjectAssignment[] = member.assignments?.map(assignment => ({
        id: assignment.project.id,
        name: assignment.project.name,
        color: assignment.project.color,
        startDate: assignment.project.startDate,
        endDate: assignment.project.endDate,
        startHour: assignment.project.startHour,
        endHour: assignment.project.endHour,
        location: assignment.project.location,
        description: assignment.project.description,
        client: assignment.project.client,
        brief: assignment.project.brief,
        logistics: assignment.project.logistics,
        assignmentRole: assignment.role,
        assignedAt: assignment.createdAt.toISOString()
      })) || [];

      // Sort projects by assigned date (newest first) or start date
      projects.sort((a, b) => {
        const dateA = a.startDate ? new Date(a.startDate) : new Date(a.assignedAt);
        const dateB = b.startDate ? new Date(b.startDate) : new Date(b.assignedAt);
        return dateB.getTime() - dateA.getTime(); // Descending order
      });

      return projects;

    } catch (err) {
      console.error("Error fetching projects by member:", err);
      throw new Error("Failed to fetch member projects");
    }
  }

  // Keep the existing endpoint method for external calls
  // public getAllProjectsByMember = async (
  //   req: Request<{}, {}, IGetAllProjectsByMemberRequest>,
  //   res: Response<IGetAllProjectsByMemberResponse>
  // ) => {
  //   try {
  //     const { memberId, companyId } = req.body;

  //     // Validate required fields
  //     if (!memberId || !companyId) {
  //       return res.status(400).json({
  //         success: false,
  //         message: "Member ID and Company ID are required",
  //         projects: [],
  //         totalCount: 0
  //       });
  //     }

  //     const projects = await this.getMemberProjects(memberId, companyId);

  //     // Find member for response
  //     const member = await memberRepo.findOne({
  //       where: { id: memberId },
  //       select: ['id', 'name', 'email', 'role']
  //     });

  //     return res.status(200).json({
  //       success: true,
  //       message: `Projects retrieved successfully for ${member?.name || 'member'}`,
  //       projects,
  //       totalCount: projects.length,
  //       member: member ? {
  //         id: member.id,
  //         name: member.name,
  //         email: member.email,
  //         role: member.role
  //       } : undefined
  //     });

  //   } catch (err: any) {
  //     console.error("Error fetching projects by member:", err);
  //     return res.status(500).json({
  //       success: false,
  //       message: err.message || "Server error while fetching projects",
  //       projects: [],
  //       totalCount: 0
  //     });
  //   }
  // };
}

export default new GoogleCalendarController();