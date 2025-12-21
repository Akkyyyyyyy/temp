// services/GoogleCalendarService.ts
import { calendar } from '@googleapis/calendar';
import { OAuth2Client } from 'google-auth-library';
import { AppDataSource } from '../config/data-source';
import { GoogleToken } from '../entity/GoogleToken';
import { EventAssignment } from '../entity/EventAssignment';
import { Events } from '../entity/Events';
import { Member } from '../entity/Member';
import { Not, IsNull } from 'typeorm';

const googleTokenRepo = AppDataSource.getRepository(GoogleToken);
const assignmentRepo = AppDataSource.getRepository(EventAssignment);
const memberRepo = AppDataSource.getRepository(Member);
const eventsRepo = AppDataSource.getRepository(Events);

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
      return { success: true, message: 'Google Calendar connected successfully' };
    } catch (error) {
      console.error('❌ Error in Google OAuth callback:', error);
      return { success: false, message: 'Failed to connect Google Calendar' };
    }
  }

  // Get authenticated OAuth2Client with valid credentials
  public async getAuthenticatedClient(memberId: string): Promise<OAuth2Client> {
    try {
      console.log("🔑 Getting authenticated client for member:", memberId);

      // Import necessary TypeORM decorators if not already imported
      // import { Not, IsNull } from 'typeorm';

      // First try to get active token
      let token = await googleTokenRepo.findOne({
        where: {
          member: { id: memberId },
          isActive: true,
        },
        relations: ['member']
      });

      // If no active token, check for ANY token with refresh token
      if (!token) {
        console.log("⚠️ No active token found, checking for any token with refresh token...");
        token = await googleTokenRepo.findOne({
          where: {
            member: { id: memberId },
            refreshToken: Not(IsNull()) // Has refresh token
          },
          relations: ['member']
        });

        if (token) {
          console.log("🔄 Found inactive token with refresh token, activating it...");
          token.isActive = true;
          await googleTokenRepo.save(token);
        }
      }

      if (!token) {
        throw new Error('No Google token found. Please connect Google Calendar first.');
      }

      if (!token.refreshToken) {
        throw new Error('No refresh token available. Please reconnect Google Calendar.');
      }

      // Create OAuth2 client
      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      // Set the refresh token as credentials
      oauth2Client.setCredentials({
        refresh_token: token.refreshToken
      });

      // Get access token (this will refresh if needed)
      const { credentials } = await oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error('Failed to get access token');
      }

      // Update token in database
      token.accessToken = credentials.access_token;
      token.expiryDate = new Date(Date.now() + (credentials.expiry_date || 3600 * 1000));
      token.tokenType = credentials.token_type || 'Bearer';

      if (credentials.refresh_token) {
        token.refreshToken = credentials.refresh_token;
      }

      await googleTokenRepo.save(token);

      // Set the access token for immediate use
      oauth2Client.setCredentials({
        access_token: credentials.access_token,
        refresh_token: token.refreshToken,
        expiry_date: credentials.expiry_date,
        token_type: credentials.token_type,
        scope: credentials.scope
      });

      console.log("✅ Successfully authenticated client");
      return oauth2Client;

    } catch (error: any) {
      console.error('❌ Error getting authenticated client:', error);

      // Mark any token as inactive if refresh failed
      if (error.message?.includes('invalid_grant') ||
        error.code === 400 ||
        error.response?.data?.error === 'invalid_grant') {

        console.log("🔒 Invalid grant - deactivating token");
        await googleTokenRepo.update(
          { member: { id: memberId } },
          { isActive: false }
        );

        throw new Error('Google authentication expired. Please reconnect Google Calendar.');
      }

      // Re-throw other errors
      throw error;
    }
  }
  // Get valid access token (for backward compatibility)
  async getValidAccessToken(memberId: string): Promise<string> {
    try {
      console.log("🔑 Getting valid access token for member:", memberId);

      const oauth2Client = await this.getAuthenticatedClient(memberId);

      // Get the access token directly
      const accessToken = await oauth2Client.getAccessToken();

      if (!accessToken?.token) {
        throw new Error('Failed to get valid access token');
      }

      return accessToken.token;

    } catch (error) {
      console.error('❌ Error getting valid access token:', error);
      throw error;
    }
  }

  // SYNC EVENT TO GOOGLE CALENDAR (SINGLE DAY EVENT)
  async syncEventToCalendar(
    memberId: string,
    event: Events,
    assignmentId?: string
  ): Promise<{ success: boolean; eventId?: string; message: string }> {
    try {
      console.log(`🔄 Starting sync for event: ${event.name} for member: ${memberId}`);

      // Get authenticated client
      const oauth2Client = await this.getAuthenticatedClient(memberId);
      const googleCalendar = calendar({ version: 'v3', auth: oauth2Client });

      // Convert event to Google Calendar event
      const calendarEvent = this.eventToCalendarEvent(event);

      // Find if there's an existing event for this assignment
      let existingEventId: string | null = null;

      if (assignmentId) {
        const assignment = await assignmentRepo.findOne({
          where: { id: assignmentId },
          relations: ['events']
        });

        if (assignment?.googleEventId) {
          existingEventId = assignment.googleEventId;
        } else {
          // Try to find by event ID in extended properties
          existingEventId = await this.findExistingEvent(googleCalendar, event.id);
        }
      }

      let result;
      if (existingEventId) {
        console.log(`🔄 Updating existing event: ${event.name} (Event ID: ${existingEventId})`);
        result = await googleCalendar.events.update({
          calendarId: 'primary',
          eventId: existingEventId,
          requestBody: calendarEvent
        });
        console.log(`✅ Updated event: ${event.name}`);
      } else {
        console.log(`🔄 Creating new event for: ${event.name}`);
        result = await googleCalendar.events.insert({
          calendarId: 'primary',
          requestBody: calendarEvent
        });
        console.log(`✅ Created event: ${event.name}`);
      }

      // Update the assignment with googleEventId if assignmentId is provided
      if (assignmentId && result.data.id) {
        try {
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
      console.error(`❌ Error syncing event "${event.name}":`, error);

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

  // CONVERT EVENT TO GOOGLE CALENDAR EVENT (SINGLE DAY)
  private eventToCalendarEvent(event: Events): any {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Get project details if available
    const projectName = event.project?.name || 'Unknown Project';
    const clientName = event.project?.client?.name || 'N/A';
    const companyName = event.project?.company?.name || 'Unknown Company';

    // Format date for single day event
    const eventDate = new Date(event.date);
    const eventDateStr = eventDate.toISOString().split('T')[0];

    // Determine if it's an all-day event or has specific hours
    const hasHours = event.startHour !== null && event.endHour !== null;

    const description = `
<b>${event.name}</b>

<b>Project:</b> ${projectName}
<b>Client:</b> ${clientName}
<b>Location:</b> ${event.location || 'Not specified'}
<b>Company:</b> ${companyName}

<small><i>Event synced from The Weddx Calendar Platform</i></small>
    `.trim();

    const extendedProperties = {
      private: {
        eventId: event.id,
        projectId: event.project?.id,
        source: 'Weddex-Sync',
        syncTime: new Date().toISOString()
      }
    };

    if (hasHours) {
      // Event with specific hours
      const startDateTime = new Date(eventDate);
      startDateTime.setHours(event.startHour!, 0, 0, 0);

      const endDateTime = new Date(eventDate);
      endDateTime.setHours(event.endHour!, 0, 0, 0);

      return {
        summary: event.name,
        description,
        location: event.location || '',
        // colorId: this.getColorId(event.color),
        extendedProperties,
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone,
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone,
        },
      };
    } else {
      // All-day event
      const nextDay = new Date(eventDate);
      nextDay.setDate(nextDay.getDate() + 1);

      return {
        summary: event.name,
        description,
        location: event.location || '',
        // colorId: this.getColorId(event.color),
        extendedProperties,
        start: {
          date: eventDateStr,
        },
        end: {
          date: nextDay.toISOString().split('T')[0],
        },
      };
    }
  }

  // Get Google Calendar color ID based on event color
  private getColorId(color?: string): string {
    const colorMap: { [key: string]: string } = {
      'blue': '1',
      'green': '2',
      'purple': '3',
      'red': '4',
      'yellow': '5',
      'orange': '6',
      'turquoise': '7',
      'gray': '8',
      'bold-blue': '9',
      'bold-green': '10',
      'bold-red': '11'
    };

    return colorMap[color || 'blue'] || '1'; // Default to blue
  }

  // Find existing event by event ID in extended properties
  private async findExistingEvent(calendar: any, eventId: string): Promise<string | null> {
    try {
      const response = await calendar.events.list({
        calendarId: 'primary',
        privateExtendedProperty: [`eventId=${eventId}`],
        maxResults: 1,
        showDeleted: false,
        singleEvents: true
      });

      const existingEvents = response.data.items;
      if (existingEvents && existingEvents.length > 0) {
        const validEvent = existingEvents.find(event =>
          event.extendedProperties?.private?.eventId === eventId
        );

        if (validEvent) {
          return validEvent.id;
        }
      }

      return null;
    } catch (error) {
      console.error('❌ Error finding existing event:', error);
      return null;
    }
  }

  // Edit calendar event
  async editCalendarEvent(
    memberId: string,
    event: Events,
    googleEventId?: string
  ): Promise<{ success: boolean; eventId?: string; message: string }> {
    try {
      console.log(`🔄 Starting event edit for: ${event.name}`);

      // Get authenticated client
      const oauth2Client = await this.getAuthenticatedClient(memberId);
      const googleCalendar = calendar({ version: 'v3', auth: oauth2Client });

      const calendarEvent = this.eventToCalendarEvent(event);
      let eventIdToUpdate = googleEventId;

      if (!eventIdToUpdate) {
        eventIdToUpdate = await this.findExistingEvent(googleCalendar, event.id);
      }

      if (!eventIdToUpdate) {
        return {
          success: false,
          message: 'No existing Google Calendar event found to update.'
        };
      }

      const result = await googleCalendar.events.update({
        calendarId: 'primary',
        eventId: eventIdToUpdate,
        requestBody: calendarEvent
      });

      console.log(`✅ Successfully updated event: ${event.name}`);

      return {
        success: true,
        eventId: result.data.id,
        message: 'Google Calendar event updated successfully'
      };

    } catch (error: any) {
      console.error(`❌ Error editing calendar event "${event.name}":`, error);

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
        console.log(`❌ Event not found, creating new event...`);
        return await this.syncEventToCalendar(memberId, event);
      }

      return {
        success: false,
        message: error.message || 'Failed to update Google Calendar event'
      };
    }
  }

  // Delete calendar event
  async deleteCalendarEvent(
    memberId: string,
    googleEventId?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!googleEventId) {
        return {
          success: false,
          message: 'No Google Calendar event ID provided'
        };
      }

      // Get authenticated client
      const oauth2Client = await this.getAuthenticatedClient(memberId);
      const googleCalendar = calendar({ version: 'v3', auth: oauth2Client });

      await googleCalendar.events.delete({
        calendarId: 'primary',
        eventId: googleEventId
      });

      console.log(`✅ Successfully deleted Google Calendar event: ${googleEventId}`);

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

  async hasGoogleAuth(memberId: string): Promise<boolean> {
    try {
      console.log("🔍 Checking Google auth for member:", memberId);

      // Check for ANY token with refresh token
      const token = await googleTokenRepo.findOne({
        where: {
          member: { id: memberId },
          refreshToken: Not(IsNull()) // Has refresh token
        }
      });

      if (!token) {
        console.log("❌ No token with refresh token found");
        return false;
      }

      // Try to get authenticated client
      try {
        await this.getAuthenticatedClient(memberId);
        return true;
      } catch (error) {
        console.error("❌ Failed to authenticate:", error);

        // Check if it's a recoverable auth error
        if (error.message?.includes('invalid_grant') ||
          error.message?.includes('token expired') ||
          error.message?.includes('Google authentication expired')) {
          console.log("⚠️ Auth exists but needs reconnection");
          return false; // User needs to reconnect
        }

        return false;
      }

    } catch (error) {
      console.error("❌ Error in hasGoogleAuth:", error);
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
}

export default new GoogleCalendarService();