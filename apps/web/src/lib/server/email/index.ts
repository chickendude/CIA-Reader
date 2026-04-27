import nodemailer from 'nodemailer';
import { SMTP_FROM, SMTP_HOST, SMTP_PASS, SMTP_PORT, SMTP_USER } from '../env.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
});

export async function sendMail(mail: Mail): Promise<void> {
  await transporter.sendMail({
    from: SMTP_FROM,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html ?? mail.text,
  });
}

export function buildMagicLinkEmail(email: string, url: string): Mail {
  return {
    to: email,
    subject: 'Your CIA Reader sign-in link',
    text: `Click this link to sign in to CIA Reader:\n\n${url}\n\nThe link is valid for 15 minutes and can only be used once. If you didn't request it, ignore this email.`,
    html: `
      <p>Click this link to sign in to CIA Reader:</p>
      <p><a href="${url}">${url}</a></p>
      <p>The link is valid for 15 minutes and can only be used once. If you didn't request it, ignore this email.</p>
    `,
  };
}
