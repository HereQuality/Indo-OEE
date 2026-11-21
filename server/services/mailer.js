const nodemailer = require("nodemailer");

/**
 * services/mailer.js
 * ───────────────────
 * The one SMTP transport, from .env:
 *
 *   SMTP_HOST      e.g. smtp.gmail.com
 *   SMTP_PORT      587 (STARTTLS) or 465 (TLS)
 *   SMTP_SECURE    "true" for port 465, else leave out
 *   SMTP_USER      the mailbox that sends
 *   SMTP_PASS      its password / app password
 *   SMTP_FROM      optional "Name <address>" shown as the sender (SMTP_USER if left out)
 *
 * Without SMTP_HOST nothing is sent: isConfigured() says so, and the
 * Company page shows what's missing instead of failing quietly.
 */
const isConfigured = () => !!process.env.SMTP_HOST;

let transport = null;
const getTransport = () => {
  if (!isConfigured()) return null;
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
};

// Sends one message; resolves to nodemailer's info, throws when SMTP isn't set
// up or refuses the message.
const sendMail = async ({ to, subject, html, text, attachments }) => {
  const t = getTransport();
  if (!t) throw new Error("Email isn't set up on the server (SMTP_HOST, SMTP_USER, SMTP_PASS in .env)");
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return t.sendMail({ from, to, subject, html, text, attachments });
};

module.exports = { isConfigured, sendMail };
