import ejs from 'ejs';
import path from 'path';
import fs from 'fs';

export interface EmailTemplateData {
  name: string;
  email: string;
  password: string;
  companyName: string;
  loginUrl: string;
  websiteUrl: string;
  subject: string;
  primaryColor?: string;
  secondaryColor?: string;
}

export interface ForgotPasswordTemplateData {
  otp: string;
  companyName: string;
  expiryTime: string;
  subject: string;
}

export interface ProjectReminderTemplateData {
  memberName: string;
  projectName: string;
  projectDescription: string;
  startDate: string;
  startHour: number;
  endHour: number;
  location: string;
  companyName: string;
  reminderType: 'weekBefore' | 'dayBefore';
  daysUntilStart: number;
  subject: string;
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

  async renderNewMemberEmail(data: Omit<EmailTemplateData, 'subject'>): Promise<{ subject: string; html: string }> {
    const completeData: EmailTemplateData = {
      ...data,
      subject: `Welcome to ${data.companyName}! Your account has been created`
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

  async renderProjectReminderEmail(data: Omit<ProjectReminderTemplateData, 'subject'>): Promise<{ subject: string; html: string }> {
    const reminderText = data.reminderType === 'weekBefore' ? '1 week' : '1 day';
    const dayLabel = data.daysUntilStart === 1 ? 'day' : 'days';

    const completeData: ProjectReminderTemplateData = {
      ...data,
      subject: `Reminder: ${data.projectName} starts in ${data.daysUntilStart} ${dayLabel}`
    };

    const html = await this.renderTemplate('project-reminder', completeData);

    return {
      subject: completeData.subject,
      html
    };
  }

}

export const emailRenderer = new EmailRenderer();