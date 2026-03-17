/**
 * Email utility – sends verification and password reset emails.
 * Uses Nodemailer with configurable SMTP settings.
 *
 * In development/testing, emails are logged to the console instead of sent
 * unless SMTP credentials are configured.
 */

const nodemailer = require('nodemailer');

// Build transporter based on environment
let transporter;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    // Production: real SMTP
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  } else {
    // Development: log to console (or use Ethereal test account)
    transporter = {
      sendMail: async (options) => {
        console.log('═══════════════════════════════════════════');
        console.log('📧 EMAIL (dev mode – not actually sent)');
        console.log(`   To:      ${options.to}`);
        console.log(`   Subject: ${options.subject}`);
        console.log(`   Body:    ${options.text || '(HTML only)'}`);
        if (options.html) {
          // Extract link from HTML for easy dev testing
          const linkMatch = options.html.match(/href="([^"]+)"/);
          if (linkMatch) {
            console.log(`   🔗 Link: ${linkMatch[1]}`);
          }
        }
        console.log('═══════════════════════════════════════════');
        return { messageId: `dev-${Date.now()}` };
      }
    };
  }

  return transporter;
}

const FROM_EMAIL = process.env.SMTP_FROM || 'noreply@lancastertravel.app';
const APP_URL = process.env.APP_URL || 'http://localhost:5001';

/**
 * Send email verification link to newly registered user.
 */
async function sendVerificationEmail(email, token, firstName) {
  const verifyUrl = `${APP_URL}?verify=${token}`;

  const mailOptions = {
    from: `"Lancaster Travel" <${FROM_EMAIL}>`,
    to: email,
    subject: 'Verify your Lancaster Travel account',
    text: `Hi ${firstName},\n\nWelcome to Lancaster Travel! Please verify your email address by visiting this link:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't create an account, please ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #2196F3;">Welcome to Lancaster Travel!</h2>
        <p>Hi ${firstName},</p>
        <p>Thanks for signing up. Please verify your email address by clicking the button below:</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${verifyUrl}" style="background: #2196F3; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Verify Email Address
          </a>
        </div>
        <p style="color: #888; font-size: 13px;">This link expires in 24 hours. If you didn't create an account, please ignore this email.</p>
      </div>
    `
  };

  return getTransporter().sendMail(mailOptions);
}

/**
 * Send password reset link.
 */
async function sendPasswordResetEmail(email, token, firstName) {
  const resetUrl = `${APP_URL}?reset=${token}`;

  const mailOptions = {
    from: `"Lancaster Travel" <${FROM_EMAIL}>`,
    to: email,
    subject: 'Reset your Lancaster Travel password',
    text: `Hi ${firstName},\n\nWe received a request to reset your password. Visit this link to create a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn't request a password reset, please ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
        <h2 style="color: #2196F3;">Password Reset</h2>
        <p>Hi ${firstName},</p>
        <p>We received a request to reset your password. Click the button below to create a new one:</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${resetUrl}" style="background: #2196F3; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">
            Reset Password
          </a>
        </div>
        <p style="color: #888; font-size: 13px;">This link expires in 1 hour. If you didn't request this, please ignore this email — your password won't change.</p>
      </div>
    `
  };

  return getTransporter().sendMail(mailOptions);
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
