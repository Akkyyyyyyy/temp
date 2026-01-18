import nodemailer from "nodemailer";
import { emailRenderer } from "../emails/emailRenderer";

export const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

export const sendEmail = async (to: string, subject: string, html: string) => {
  await transporter.sendMail({
    from: `${process.env.SMTP_EMAIL}`,
    to,
    subject,
    html,
  });
};

export const sendNewMemberEmail = async (
  to: string,
  name: string,
  inviteLink: string, // Changed from password to inviteLink
  companyName: string,
  adminName:string,
  roleName?: string // Added optional role name
) => {
  const { subject, html } = await emailRenderer.renderNewMemberEmail({
    name,
    email: to,
    inviteLink, // Pass inviteLink instead of password
    companyName,
    roleName: roleName || 'Member', // Include role name
    loginUrl: process.env.VITE_FRONTEND_URL,
    websiteUrl: process.env.VITE_FRONTEND_URL,
    adminName: adminName
  });

  await sendEmail(to, subject, html);
};

export const sendForgotPasswordEmail = async (
  to: string,
  otp: string,
  companyName: string = 'Our Platform',
  expiryTime: string = '15 minutes'
) => {
  const { subject, html } = await emailRenderer.renderForgotPasswordEmail({
    otp,
    companyName,
    expiryTime
  });

  await sendEmail(to, subject, html);
};

export const sendEventReminderEmail = async (
  to: string,
  memberName: string,
  eventName: string,
  projectName: string,
  eventDate: string,
  startHour: string,
  endHour: string,
  location: string,
  companyName: string,
  reminderType: 'weekBefore' | 'dayBefore',
  daysUntilEvent: number,
) => {
  const { subject, html } = await emailRenderer.renderEventReminderEmail({
    memberName,
    eventName,
    projectName,
    eventDate,
    startHour,
    endHour,
    location,
    companyName,
    reminderType,
    daysUntilEvent
  });

  await sendEmail(to, subject, html);
};

export const sendProjectEventsAssignmentEmail = async (
  to: string,
  memberName: string,
  projectName: string,
  events: Array<{
    eventName: string;
    eventDate: string;
    startHour: string;
    endHour: string;
    location: string;
  }>,
  companyName: string
) => {
  const { subject, html } = await emailRenderer.renderProjectEventsAssignmentEmail({
    memberName,
    projectName,
    events,
    companyName
  });

  await sendEmail(to, subject, html);
};