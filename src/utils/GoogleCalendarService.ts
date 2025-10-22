// services/GoogleCalendarService.ts
import { calendar } from '@googleapis/calendar';
import { OAuth2Client } from 'google-auth-library';
import { AppDataSource } from '../config/data-source';
import { GoogleToken } from '../entity/GoogleToken';
import { Member } from '../entity/Member';
import { ProjectAssignment } from '../entity/ProjectAssignment';

const googleTokenRepo = AppDataSource.getRepository(GoogleToken);
const memberRepo = AppDataSource.getRepository(Member);

export class GoogleCalendarService {

  private readonly oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  // Generate authorization URL
  generateAuthUrl(memberId: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      state: memberId,
      prompt: 'consent'
    });
  }

  // Handle OAuth callback and save tokens
  async handleCallback(code: string, state: string): Promise<{ success: boolean; message: string }> {
    try {
      // console.log('🔄 Handling OAuth callback...');
      const { tokens } = await this.oauth2Client.getToken(code);

      if (!tokens.refresh_token) {
        throw new Error('No refresh token received');
      }

      const member = await memberRepo.findOneBy({ id: state });
      if (!member) {
        throw new Error('Member not found');
      }

      const expiryDate = new Date(Date.now() + (tokens.expiry_date || 3600 * 1000));

      // Deactivate any existing tokens
      await googleTokenRepo.update(
        { member: { id: state }, isActive: true },
        { isActive: false }
      );

      // Save new token
      const googleToken = googleTokenRepo.create({
        member,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token!,
        expiryDate,
        scope: tokens.scope!,
        tokenType: tokens.token_type!,
        isActive: true
      });

      await googleTokenRepo.save(googleToken);
      // console.log('✅ Google tokens saved successfully');

      return { success: true, message: 'Google Calendar connected successfully' };
    } catch (error) {
      // console.error('❌ Error in Google OAuth callback:', error);
      return { success: false, message: 'Failed to connect Google Calendar' };
    }
  }

  // Get valid access token (refreshes if needed)
  async getValidAccessToken(memberId: string): Promise<string> {
    try {
      const activeToken = await googleTokenRepo.findOne({
        where: { member: { id: memberId }, isActive: true },
        relations: ['member']
      });

      if (!activeToken) {
        throw new Error('No active Google token found. Please connect Google Calendar first.');
      }

      // console.log('🔑 Token status:', {
      //   isExpired: activeToken.isExpired(),
      //   expiryDate: activeToken.expiryDate,
      //   currentTime: new Date()
      // });

      // If token is still valid, return it
      if (!activeToken.isExpired()) {
        // console.log('✅ Using existing valid access token');
        return activeToken.accessToken;
      }

      // console.log('🔄 Access token expired, refreshing...');
      // Token is expired, refresh it
      return await this.refreshAccessToken(activeToken);

    } catch (error) {
      console.error('❌ Error getting valid access token:', error);
      throw error;
    }
  }

  // Refresh access token
  private async refreshAccessToken(googleToken: GoogleToken): Promise<string> {
    try {
      // console.log('🔄 Refreshing access token...');

      this.oauth2Client.setCredentials({
        refresh_token: googleToken.refreshToken
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      // console.log('✅ Successfully refreshed access token');

      // Update token in database
      googleToken.accessToken = credentials.access_token!;
      googleToken.expiryDate = new Date(Date.now() + (credentials.expiry_date || 3600 * 1000));
      googleToken.tokenType = credentials.token_type!;

      await googleTokenRepo.save(googleToken);

      return credentials.access_token!;
    } catch (error: any) {
      console.error('❌ Error refreshing token:', error);

      // If refresh fails, mark token as inactive
      googleToken.isActive = false;
      await googleTokenRepo.save(googleToken);

      if (error.message.includes('invalid_grant')) {
        throw new Error('Google authentication expired. Please reconnect Google Calendar.');
      }

      throw new Error('Token refresh failed. Please re-authenticate.');
    }
  }

  // Sync project to Google Calendar
async syncProjectToCalendar(
    memberId: string, 
    project: any, 
    assignmentId?: string // Add assignmentId parameter
): Promise<{ success: boolean; eventId?: string; message: string }> {
    try {
        console.log(`🔄 Starting sync for project: ${project.name} for member: ${memberId}`);

        const accessToken = await this.getValidAccessToken(memberId);

        const oauth2Client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials({ access_token: accessToken });

        const googleCalendar = calendar({ version: 'v3', auth: oauth2Client });

        const event = this.projectToCalendarEvent(project);
        const existingEventId = await this.findExistingEvent(googleCalendar, project);

        let result;
        if (existingEventId) {
            console.log(`🔄 Updating existing event for: ${project.name} (Event ID: ${existingEventId})`);
            result = await googleCalendar.events.update({
                calendarId: 'primary',
                eventId: existingEventId,
                requestBody: event
            });
            console.log(`✅ Updated event for: ${project.name}`);
        } else {
            console.log(`🔄 Creating new event for: ${project.name}`);
            result = await googleCalendar.events.insert({
                calendarId: 'primary',
                requestBody: event
            });
            console.log(`✅ Created event for: ${project.name}`);
        }

        // Update the assignment with googleEventId if assignmentId is provided
        if (assignmentId && result.data.id) {
            try {
                const assignmentRepo = AppDataSource.getRepository(ProjectAssignment);
                await assignmentRepo.update(assignmentId, {
                    googleEventId: result.data.id
                });
                console.log(`✅ Updated assignment ${assignmentId} with googleEventId: ${result.data.id}`);
            } catch (updateError) {
                console.error(`❌ Failed to update assignment with googleEventId:`, updateError);
            }
        }

        return {
            success: true,
            eventId: result.data.id,
            message: existingEventId ? 'Event updated' : 'Event created'
        };

    } catch (error: any) {
        console.error(`❌ Error syncing project "${project.name}":`, error);

        if (error.code === 401 || error.message.includes('authentication expired')) {
            await googleTokenRepo.update(
                { member: { id: memberId }, isActive: true },
                { isActive: false }
            );
            return {
                success: false,
                message: 'Google authentication expired. Please reconnect Google Calendar.'
            };
        }

        return { success: false, message: error.message || 'Failed to sync to calendar' };
    }
}




  // Check if member has Google Calendar connected
  async hasGoogleAuth(memberId: string): Promise<boolean> {
    try {
      const activeToken = await googleTokenRepo.findOne({
        where: { member: { id: memberId }, isActive: true }
      });

      if (!activeToken) {
        return false;
      }

      // Check if token is still valid or can be refreshed
      if (!activeToken.isExpired()) {
        return true;
      }

      // Try to refresh to see if the refresh token is still valid
      try {
        await this.getValidAccessToken(memberId);
        return true;
      } catch {
        return false;
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      return false;
    }
  }

  // Disconnect Google Calendar
  async disconnect(memberId: string): Promise<{ success: boolean; message: string }> {
    try {
      const activeToken = await googleTokenRepo.findOne({
        where: { member: { id: memberId }, isActive: true }
      });

      if (activeToken) {
        try {
          await this.oauth2Client.revokeToken(activeToken.accessToken);
        } catch (revokeError) {
          console.warn('Could not revoke token with Google:', revokeError);
        }
      }

      await googleTokenRepo.update(
        { member: { id: memberId } },
        { isActive: false }
      );

      return { success: true, message: 'Google Calendar disconnected successfully' };
    } catch (error) {
      console.error('Error disconnecting Google Calendar:', error);
      return { success: false, message: 'Failed to disconnect Google Calendar' };
    }
  }

  // Project to calendar event conversion - ENHANCED VERSION
  private projectToCalendarEvent(project: any): any {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Safely handle client object
    let clientName = 'N/A';
    if (project.client) {
      if (typeof project.client === 'string') {
        clientName = project.client;
      } else if (project.client.name) {
        clientName = project.client.name;
      } else {
        clientName = 'Client details available';
      }
    }

    // Ensure project ID is properly set in extended properties
    const extendedProperties = {
      private: {
        projectId: project.id?.toString(),
        source: 'VIP-Studio-Sync',
        syncTime: new Date().toISOString()
      }
    };

    // console.log(`📝 Creating event with extended properties:`, extendedProperties.private);

    const baseEvent = {
      summary: project.name,
      description: `Project: ${project.name}\nRole: ${project.assignmentRole}\nClient: ${clientName}\nLocation: ${project.location || 'N/A'}\nDescription: ${project.description || 'N/A'}`,
      location: project.location || '',
      extendedProperties: extendedProperties,
    };

    // Handle projects with dates
    if (project.startDate && project.endDate) {
      const start = new Date(project.startDate);
      const end = new Date(project.endDate);
      const isMultiDay = start.toDateString() !== end.toDateString();

      if (isMultiDay) {
        // Multi-day event
        const endDate = new Date(end);
        endDate.setDate(endDate.getDate() + 1);

        if (project.startHour && project.endHour) {
          // Multi-day with specific hours
          const startDateTime = new Date(project.startDate);
          startDateTime.setHours(project.startHour, 0, 0, 0);

          const endDateTime = new Date(project.startDate);
          endDateTime.setHours(project.endHour, 0, 0, 0);

          return {
            ...baseEvent,
            start: {
              dateTime: startDateTime.toISOString(),
              timeZone: timeZone,
            },
            end: {
              dateTime: endDateTime.toISOString(),
              timeZone: timeZone,
            },
            recurrence: [`RRULE:FREQ=DAILY;UNTIL=${this.formatDate(end).replace(/-/g, '')}T235959Z`],
          };
        } else {
          // Multi-day all-day events
          return {
            ...baseEvent,
            start: { date: project.startDate },
            end: { date: endDate.toISOString().split('T')[0] },
            recurrence: [`RRULE:FREQ=DAILY;UNTIL=${this.formatDate(end).replace(/-/g, '')}T235959Z`],
          };
        }
      } else {
        // Single day event
        if (project.startHour && project.endHour) {
          const startDateTime = new Date(project.startDate);
          startDateTime.setHours(project.startHour, 0, 0, 0);

          const endDateTime = new Date(project.startDate);
          endDateTime.setHours(project.endHour, 0, 0, 0);

          return {
            ...baseEvent,
            start: {
              dateTime: startDateTime.toISOString(),
              timeZone: timeZone,
            },
            end: {
              dateTime: endDateTime.toISOString(),
              timeZone: timeZone,
            },
          };
        } else {
          return {
            ...baseEvent,
            start: { date: project.startDate },
            end: { date: project.startDate },
          };
        }
      }
    }

    // Fallback for projects without dates
    const today = new Date().toISOString().split('T')[0];
    if (project.startHour && project.endHour) {
      const startDateTime = new Date();
      startDateTime.setHours(project.startHour, 0, 0, 0);

      const endDateTime = new Date();
      endDateTime.setHours(project.endHour, 0, 0, 0);

      return {
        ...baseEvent,
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: timeZone,
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: timeZone,
        },
        description: baseEvent.description + '\nNote: This project has no specific dates assigned.',
      };
    } else {
      return {
        ...baseEvent,
        start: { date: today },
        end: { date: today },
        description: baseEvent.description + '\nNote: This project has no specific dates assigned.',
      };
    }
  }
  async editCalendarEvent(
    memberId: string,
    project: any,
    googleEventId?: string
  ): Promise<{ success: boolean; eventId?: string; message: string }> {
    try {
      // console.log(`🔄 Starting event edit for project: ${project.name}`);

      const accessToken = await this.getValidAccessToken(memberId);

      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      oauth2Client.setCredentials({ access_token: accessToken });

      const googleCalendar = calendar({ version: 'v3', auth: oauth2Client });

      // Convert project to calendar event
      const event = this.projectToCalendarEvent(project);

      let eventIdToUpdate = googleEventId;

      // If no event ID provided, try to find existing event
      if (!eventIdToUpdate) {
        eventIdToUpdate = await this.findExistingEvent(googleCalendar, project);
      }

      if (!eventIdToUpdate) {
        return {
          success: false,
          message: 'No existing Google Calendar event found to update. Please create a new event first.'
        };
      }

      // console.log(`🔄 Updating event for project: ${project.name} (Event ID: ${eventIdToUpdate})`);

      const result = await googleCalendar.events.update({
        calendarId: 'primary',
        eventId: eventIdToUpdate,
        requestBody: event
      });

      // console.log(`✅ Successfully updated event for project: ${project.name}`);

      return {
        success: true,
        eventId: result.data.id,
        message: 'Google Calendar event updated successfully'
      };

    } catch (error: any) {
      console.error(`❌ Error editing calendar event for project "${project.name}":`, error);

      if (error.code === 401 || error.message.includes('authentication expired')) {
        await googleTokenRepo.update(
          { member: { id: memberId }, isActive: true },
          { isActive: false }
        );
        return {
          success: false,
          message: 'Google authentication expired. Please reconnect Google Calendar.'
        };
      }

      if (error.code === 404) {
        console.log(`❌ Event not found, it may have been deleted. Creating new event...`);
        // Fallback to creating a new event
        return await this.syncProjectToCalendar(memberId, project);
      }

      return {
        success: false,
        message: error.message || 'Failed to update Google Calendar event'
      };
    }
  }
  async deleteCalendarEvent(
    memberId: string,
    googleEventId?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // console.log(`🔄 Starting event deletion for member: ${memberId}, event: ${googleEventId}`);

      if (!googleEventId) {
        return {
          success: false,
          message: 'No Google Calendar event ID provided'
        };
      }

      const accessToken = await this.getValidAccessToken(memberId);

      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      oauth2Client.setCredentials({ access_token: accessToken });

      const googleCalendar = calendar({ version: 'v3', auth: oauth2Client });

      // console.log(`🗑️ Deleting event: ${googleEventId}`);

      await googleCalendar.events.delete({
        calendarId: 'primary',
        eventId: googleEventId
      });

      // console.log(`✅ Successfully deleted Google Calendar event: ${googleEventId}`);

      return {
        success: true,
        message: 'Google Calendar event deleted successfully'
      };

    } catch (error: any) {
      console.error(`❌ Error deleting calendar event:`, error);

      if (error.code === 401 || error.message.includes('authentication expired')) {
        await googleTokenRepo.update(
          { member: { id: memberId }, isActive: true },
          { isActive: false }
        );
        return {
          success: false,
          message: 'Google authentication expired. Please reconnect Google Calendar.'
        };
      }

      // If event not found, consider it successfully deleted
      if (error.code === 404) {
        console.log(`ℹ️ Event not found, considering it already deleted`);
        return {
          success: true,
          message: 'Event was already deleted or not found'
        };
      }

      return {
        success: false,
        message: error.message || 'Failed to delete Google Calendar event'
      };
    }
  }

  // Format date as YYYY-MM-DD
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  // Find existing event - IMPROVED VERSION
  private async findExistingEvent(calendar: any, project: any): Promise<string | null> {
    try {
      if (!project.id) {
        console.log('❌ No project ID provided, cannot find existing event');
        return null;
      }

      // console.log(`🔍 Searching for existing event with projectId: ${project.id}`);

      // Method 1: Search by extended properties (primary method)
      try {
        const response = await calendar.events.list({
          calendarId: 'primary',
          privateExtendedProperty: [`projectId=${project.id}`],
          maxResults: 10, // Increased to catch duplicates
          showDeleted: false,
          singleEvents: true
        });

        const existingEvents = response.data.items;
        // console.log(`🔍 Found ${existingEvents?.length || 0} events via extended properties`);

        if (existingEvents && existingEvents.length > 0) {
          // Return the first valid event ID
          const validEvent = existingEvents.find(event =>
            event.extendedProperties?.private?.projectId === project.id.toString()
          );

          if (validEvent) {
            // console.log(`✅ Found existing event via extended properties: ${validEvent.id}`);
            return validEvent.id;
          }
        }
      } catch (extendedPropError) {
        console.warn('❌ Extended property search failed:', extendedPropError);
      }

      return null;

    } catch (error) {
      console.error('❌ Error finding existing event:', error);
      return null;
    }
  }
}

export default new GoogleCalendarService();