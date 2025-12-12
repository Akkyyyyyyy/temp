import { Request, Response } from "express";
import { AppDataSource } from "../../config/data-source";
import { Member } from "../../entity/Member";
import { Company } from "../../entity/Company";
import GoogleCalendarService from "../../utils/GoogleCalendarService";
import { EventAssignment } from "../../entity/EventAssignment";
import { Events } from "../../entity/Events";

const memberRepo = AppDataSource.getRepository(Member);
const companyRepo = AppDataSource.getRepository(Company);
const assignmentRepo = AppDataSource.getRepository(EventAssignment);
const eventsRepo = AppDataSource.getRepository(Events);

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

  // In GoogleCalendarController.ts - Update the syncEventAssignments method

  // Sync all event assignments to calendar
  public syncEventAssignments = async (req: Request, res: Response) => {
    try {
      const memberId = req.body.memberId || res.locals.token?.memberId;

      if (!memberId) {
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

      // Fetch event assignments for this member in the company
      const assignments = await assignmentRepo.find({
        where: {
          member: { id: memberId },
        },
        relations: [
          "events",
          "events.project",
          "events.project.company",  // Keep company for filtering
          "role",
          "member"
        ],
        // Remove "events.project.client" since it's optional and might not exist
        select: {
          id: true,
          instructions: true,
          googleEventId: true,
          events: {
            id: true,
            name: true,
            date: true,
            startHour: true,
            endHour: true,
            location: true,
            project: {
              id: true,
              name: true,
              description: true,
              client: true,
              company: {     
                id: true,
                name: true,
                email: true,
                country: true
              }
            }
          },
          role: {
            id: true,
            name: true
          }
        },
        order: {
          events: {
            date: "DESC"
          }
        }
      });

      if (assignments.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No event assignments found to sync",
          synced: 0,
          failed: 0
        });
      }

      // Sync each event assignment
      let synced = 0;
      let failed = 0;
      const results = [];

      for (const assignment of assignments) {
        try {
          const result = await GoogleCalendarService.syncEventToCalendar(
            memberId,
            assignment.events,
            assignment.id
          );

          if (result.success) {
            synced++;
          } else {
            failed++;
          }

          // Safely get project name
          const projectName = assignment.events.project?.name || 'No Project';
          const clientName = assignment.events.project?.client?.name || 'N/A';
          const companyName = assignment.events.project?.company?.name || 'No Company';

          results.push({
            eventId: assignment.events.id,
            eventName: assignment.events.name,
            projectId: assignment.events.project?.id,
            projectName: projectName,
            clientName: clientName,
            companyName: companyName,
            assignmentId: assignment.id,
            success: result.success,
            message: result.message,
            googleEventId: result.eventId,
            role: assignment.role?.name || 'No Role',
            date: assignment.events.date
          });

        } catch (error: any) {
          failed++;
          results.push({
            eventId: assignment.events.id,
            eventName: assignment.events.name,
            assignmentId: assignment.id,
            success: false,
            message: error.message
          });
        }
      }

      return res.status(200).json({
        success: true,
        message: `Sync completed: ${synced} events synced, ${failed} failed`,
        synced,
        failed,
        results
      });

    } catch (error: any) {
      console.error('Error syncing event assignments:', error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to sync events"
      });
    }
  };


  public syncSingleEventAssignment = async (req: Request, res: Response) => {
    try {
      const memberId = req.body.memberId || res.locals.token?.memberId;
      const assignmentId = req.params.assignmentId;

      if (!memberId || !assignmentId) {
        return res.status(400).json({
          success: false,
          message: "Member ID and Assignment ID are required"
        });
      }

      const hasAuth = await GoogleCalendarService.hasGoogleAuth(memberId);
      if (!hasAuth) {
        return res.status(400).json({
          success: false,
          message: "Google Calendar not connected. Please connect first."
        });
      }

      const assignment = await assignmentRepo.findOne({
        where: {
          id: assignmentId,
          member: { id: memberId }
        },
        relations: [
          "events",
          "events.project",
          "role"
        ],
        select: {
          id: true,
          googleEventId: true,
          events: {
            id: true,
            name: true,
            date: true,
            startHour: true,
            endHour: true,
            location: true,
            project: {
              id: true,
              name: true,
              description: true,
              client: true
            }
          },
          role: {
            id: true,
            name: true
          }
        }
      });

      if (!assignment) {
        return res.status(404).json({
          success: false,
          message: "Event assignment not found"
        });
      }

      // Sync the event
      const result = await GoogleCalendarService.syncEventToCalendar(
        memberId,
        assignment.events,
        assignment.id
      );

      return res.status(200).json({
        success: result.success,
        message: result.message,
        googleEventId: result.eventId,
        eventId: assignment.events.id,
        eventName: assignment.events.name,
        assignmentId: assignment.id
      });

    } catch (error: any) {
      console.error('Error syncing single event assignment:', error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to sync event"
      });
    }
  };

  public updateEvent = async (req: Request, res: Response) => {
    try {
      const memberId = req.body.memberId || res.locals.token?.memberId;
      const eventId = req.params.eventId;
      const googleEventId = req.body.googleEventId;

      if (!memberId || !eventId) {
        return res.status(400).json({
          success: false,
          message: "Member ID and Event ID are required"
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

      // Fetch the event
      const event = await eventsRepo.findOne({
        where: { id: eventId },
        relations: ["project", "project.client"]
      });

      if (!event) {
        return res.status(404).json({
          success: false,
          message: "Event not found"
        });
      }

      // Update the event in Google Calendar
      const result = await GoogleCalendarService.editCalendarEvent(
        memberId,
        event,
        googleEventId
      );

      return res.status(200).json({
        success: result.success,
        message: result.message,
        googleEventId: result.eventId,
        eventId: event.id,
        eventName: event.name
      });

    } catch (error: any) {
      console.error('Error updating event:', error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to update event"
      });
    }
  };

  // DELETE EVENT FROM GOOGLE CALENDAR
  public deleteEvent = async (req: Request, res: Response) => {
    try {
      const memberId = req.body.memberId || res.locals.token?.memberId;
      const googleEventId = req.params.googleEventId;

      if (!memberId || !googleEventId) {
        return res.status(400).json({
          success: false,
          message: "Member ID and Google Event ID are required"
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

      // Delete the event from Google Calendar
      const result = await GoogleCalendarService.deleteCalendarEvent(
        memberId,
        googleEventId
      );

      // Clear googleEventId from any assignments that reference this event
      if (result.success) {
        await assignmentRepo.update(
          { googleEventId },
          { googleEventId: null }
        );
      }

      return res.status(200).json(result);

    } catch (error: any) {
      console.error('Error deleting event:', error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to delete event"
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

  // GET ALL EVENT ASSIGNMENTS FOR MEMBER (for debugging/info)
  public getEventAssignments = async (req: Request, res: Response) => {
    try {
      const memberId = req.body.memberId || res.locals.token?.memberId;
      const companyId = req.body.companyId || res.locals.token?.companyId;

      if (!memberId || !companyId) {
        return res.status(400).json({
          success: false,
          message: "Member ID and Company ID are required"
        });
      }

      const assignments = await assignmentRepo.find({
        where: {
          member: { id: memberId },
          events: {
            project: {
              company: { id: companyId }
            }
          }
        },
        relations: [
          "events",
          "events.project",
          "events.project.client",
          "role"
        ],
        select: {
          id: true,
          instructions: true,
          googleEventId: true,
          createdAt: true,
          events: {
            id: true,
            name: true,
            date: true,
            startHour: true,
            endHour: true,
            location: true,
          },
          role: {
            id: true,
            name: true
          },
          project: {
            id: true,
            name: true
          }
        },
        order: {
          events: {
            date: "DESC"
          }
        }
      });

      return res.status(200).json({
        success: true,
        assignments: assignments.map(assignment => ({
          assignmentId: assignment.id,
          googleEventId: assignment.googleEventId,
          event: {
            id: assignment.events.id,
            name: assignment.events.name,
            date: assignment.events.date,
            startHour: assignment.events.startHour,
            endHour: assignment.events.endHour,
            location: assignment.events.location,
          },
          role: assignment.role?.name,
          project: assignment.events.project ? {
            id: assignment.events.project.id,
            name: assignment.events.project.name
          } : null,
          instructions: assignment.instructions,
          isSynced: !!assignment.googleEventId
        })),
        totalCount: assignments.length
      });

    } catch (error: any) {
      console.error('Error fetching event assignments:', error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch event assignments"
      });
    }
  };
}

export default new GoogleCalendarController();