import ejs from 'ejs';
import path from 'path';
import fs from 'fs';

interface EmailTemplateData {
  name: string;
  email: string;
  companyName: string;
  loginUrl: string;
  websiteUrl: string;
  subject: string;
  inviteLink: string; // Add this
  roleName?: string; // Add this (optional)
  adminName:string;
}

export interface ForgotPasswordTemplateData {
  otp: string;
  companyName: string;
  expiryTime: string;
  subject: string;
}

interface EventReminderTemplateData {
  memberName: string;
  eventName: string;
  projectName: string;
  eventDate: string;
  startHour: string;
  endHour: string;
  location: string;
  companyName: string;
  reminderType: 'weekBefore' | 'dayBefore';
  daysUntilEvent: number;
  subject?: string;
}
export class EmailRenderer {
  private templateDir: string;

  constructor() {
    this.templateDir = path.join(__dirname, 'templates');
  }

  async renderTemplate(templateName: string, data: any): Promise<string> {
    const templatePath = path.join(this.templateDir, `${templateName}.ejs`);

    return new Promise((resolve, reject) => {
      ejs.renderFile(templatePath, data, (err, html) => {
        if (err) {
          reject(err);
        } else {
          resolve(html);
        }
      });
    });
  }
async renderNewMemberEmail(data: Omit<EmailTemplateData, 'subject'> & { 
  inviteLink: string; 
  roleName?: string;
}): Promise<{ subject: string; html: string }> {
  const completeData: EmailTemplateData & { inviteLink: string; roleName?: string } = {
    ...data,
    inviteLink: data.inviteLink,
    roleName: data.roleName || 'Member',
    subject: `Welcome to ${data.companyName}!`
  };

  const html = await this.renderTemplate('new-member', completeData);

  return {
    subject: completeData.subject,
    html
  };
}

  async renderForgotPasswordEmail(data: Omit<ForgotPasswordTemplateData, 'subject'>): Promise<{ subject: string; html: string }> {
    const completeData: ForgotPasswordTemplateData = {
      ...data,
      subject: `Password Reset OTP - ${data.companyName}`
    };

    const html = await this.renderTemplate('forgot-password', completeData);

    return {
      subject: completeData.subject,
      html
    };
  }

  async renderEventReminderEmail(data: Omit<EventReminderTemplateData, 'subject'>): Promise<{ subject: string; html: string }> {
    const dayLabel = data.daysUntilEvent === 1 ? 'day' : 'days';
    const reminderText = data.reminderType === 'weekBefore' ? '1 week' : '1 day';

    const completeData: EventReminderTemplateData = {
      ...data,
      subject: `Reminder: ${data.eventName} (${data.projectName}) in ${data.daysUntilEvent} ${dayLabel}`
    };

    const html = await this.renderTemplate('event-reminder', completeData);

    return {
      subject: completeData.subject,
      html
    };
  }
  // In EmailRenderer class
async renderProjectEventsAssignmentEmail(
  data: Omit<any, 'subject'>
): Promise<{ subject: string; html: string }> {
  const eventCount = data.events.length;
  const eventText = eventCount === 1 ? 'event' : 'events';
  
  const completeData: any = {
    ...data,
    subject: `You have been assigned to ${eventCount} ${eventText} in ${data.projectName}`
  };

  const html = await this.renderTemplate('project-events-assignment', completeData);

  return {
    subject: completeData.subject,
    html
  };
}

}

export const emailRenderer = new EmailRenderer();