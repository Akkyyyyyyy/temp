import nodemailer from "nodemailer";

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

export const sendNewMemberEmail = async (to: string, name: string, password: string) => {
  await sendEmail(
    to,
    "Your account has been created",
    `
      <p>Hello ${name},</p>
      <p>Your account has been created. Here are your login credentials:</p>
      <ul>
        <li><strong>Email:</strong> ${to}</li>
        <li><strong>Temporary Password:</strong> ${password}</li>
      </ul>
      <p>Please log in and change your password as soon as possible.</p>
      <p>Best regards,<br/>Your Team</p>
    `
  );
};
