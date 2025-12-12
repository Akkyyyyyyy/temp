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

export const sendProjectReminderEmail = async (
  to: string,
  memberName: string,
  projectName: string,
  projectDescription: string,
  startDate: string,
  startHour: number,
  endHour: number,
  location: string,
  companyName: string,
  reminderType: 'weekBefore' | 'dayBefore',
  daysUntilStart: number,
) => {
  const { subject, html } = await emailRenderer.renderProjectReminderEmail({
    memberName,
    projectName,
    projectDescription,
    startDate,
    startHour,
    endHour,
    location,
    companyName,
    reminderType,
    daysUntilStart
  });

  await sendEmail(to, subject, html);
};