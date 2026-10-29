import { Resend } from "resend";
import { appointmentDateTimeToUtc } from "./appointmentReminders.js";

/**
 * Transactional email transport with two HTTPS providers.
 *
 * Render's free web services block outbound SMTP ports (25/465/587), so only
 * HTTPS email APIs can deliver from production:
 *
 *   EMAIL_PROVIDER=resend  -> Resend API (default)
 *   EMAIL_PROVIDER=brevo   -> POST https://api.brevo.com/v3/smtp/email
 *
 * Brevo is the "no domain" option: verifying a single sender address (a Gmail
 * address is fine) is enough to email any recipient, whereas Resend's shared
 * `onboarding@resend.dev` sender only reaches the Resend account owner.
 *
 * All templates stay provider agnostic; only sendEmail() talks to a provider.
 * Public senders keep their existing signatures and return values:
 * `{ accepted: true }`, `{ skipped: true, reason }`, or a thrown error.
 */

const SUPPORTED_EMAIL_PROVIDERS = Object.freeze(["resend", "brevo"]);
const DEFAULT_EMAIL_PROVIDER = "resend";
const PROVIDER_KEY_NAMES = Object.freeze({
  resend: "RESEND_API_KEY",
  brevo: "BREVO_API_KEY",
});
const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const BREVO_TIMEOUT_MS = 15_000;
const SANDBOX_SENDER_DOMAIN = "resend.dev";
const LOG_PREFIX = "[email]";

let resendClient;
let resendClientKey;

function readEnv(name) {
  return process.env[name]?.trim() ?? "";
}

function getConfiguredProviderName() {
  return (readEnv("EMAIL_PROVIDER") || DEFAULT_EMAIL_PROVIDER).toLowerCase();
}

/** The provider used for sends; unknown values fall back to Resend. */
export function getEmailProvider() {
  const configured = getConfiguredProviderName();
  return SUPPORTED_EMAIL_PROVIDERS.includes(configured) ? configured : DEFAULT_EMAIL_PROVIDER;
}

export function isSupportedEmailProvider() {
  return SUPPORTED_EMAIL_PROVIDERS.includes(getConfiguredProviderName());
}

/**
 * Parse MAIL_FROM into { name, email }.
 * Accepts `MediGuide <appointments@example.com>`, `"MediGuide" <appointments@example.com>`
 * and a bare `appointments@example.com`. Surrounding quotes are stripped because
 * dashboards often paste `MAIL_FROM="Name <mail@host>"` verbatim.
 */
export function parseMailFrom(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
  if (!raw) return { name: "", email: "" };

  const angleMatch = raw.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (angleMatch) {
    return {
      name: angleMatch[1].trim().replace(/^["'`]|["'`]$/g, "").trim(),
      email: angleMatch[2].trim().toLowerCase(),
    };
  }

  if (/^[^\s@]+@[^\s@]+$/.test(raw)) {
    return { name: "", email: raw.toLowerCase() };
  }

  return { name: "", email: "" };
}

function formatMailFrom({ name, email }) {
  return name ? `${name} <${email}>` : email;
}

/**
 * Single source of truth for email configuration.
 * Never includes the API key itself, only whether one exists.
 */
export function getEmailConfiguration() {
  const providerName = getConfiguredProviderName();
  const providerSupported = SUPPORTED_EMAIL_PROVIDERS.includes(providerName);
  const provider = providerSupported ? providerName : DEFAULT_EMAIL_PROVIDER;
  const apiKeyName = PROVIDER_KEY_NAMES[provider];
  const apiKeyConfigured = Boolean(readEnv(apiKeyName));
  const sender = parseMailFrom(readEnv("MAIL_FROM"));
  const senderDomain = sender.email.split("@")[1] ?? "";
  const sandboxSender = senderDomain === SANDBOX_SENDER_DOMAIN;
  const appUrl = getPasswordResetAppUrl();

  const missing = [];
  if (!providerSupported) missing.push("EMAIL_PROVIDER");
  if (!apiKeyConfigured) missing.push(apiKeyName);
  if (!sender.email) missing.push("MAIL_FROM");

  return {
    provider,
    providerSupported,
    configuredProvider: providerName,
    apiKeyName,
    apiKeyConfigured,
    senderEmail: sender.email,
    senderName: sender.name,
    senderDomain,
    sandboxSender,
    // Configuration-level check only (no provider API call): the sender parses
    // and credentials exist. A Resend sandbox sender cannot be used with Brevo.
    senderVerified:
      Boolean(sender.email) && apiKeyConfigured && !(sandboxSender && provider === "brevo"),
    appUrl,
    missing,
    configured: missing.length === 0,
  };
}

/** Safe health payload: booleans plus the sender address, never the API key. */
export function getEmailHealth() {
  const config = getEmailConfiguration();

  return {
    provider: config.provider,
    apiKeyConfigured: config.apiKeyConfigured,
    senderEmail: config.senderEmail,
    senderVerified: config.senderVerified,
    // Extra diagnostics that are safe to expose (no secrets).
    senderName: config.senderName,
    senderDomain: config.senderDomain,
    sandboxSender: config.sandboxSender,
    appUrlConfigured: Boolean(config.appUrl),
    missingConfiguration: config.missing,
  };
}

/** Startup diagnostics so misconfiguration is never silent. */
export function logEmailConfiguration() {
  const config = getEmailConfiguration();

  if (!config.providerSupported) {
    console.warn(
      `${LOG_PREFIX} WARNING EMAIL_PROVIDER="${config.configuredProvider}" is not supported ` +
        `(expected resend or brevo); falling back to "${DEFAULT_EMAIL_PROVIDER}".`
    );
  }

  if (!config.apiKeyConfigured) {
    console.warn(
      `${LOG_PREFIX} WARNING ${config.apiKeyName} is not set for provider "${config.provider}". ` +
        "Email delivery will be skipped; API keys are read from the environment only."
    );
  }

  if (!config.senderEmail) {
    console.warn(
      `${LOG_PREFIX} WARNING MAIL_FROM is missing or could not be parsed. ` +
        'Use the form "MediGuide <appointments@example.com>".'
    );
  }

  if (config.sandboxSender && config.provider === "brevo") {
    console.warn(
      `${LOG_PREFIX} WARNING sender domain "${SANDBOX_SENDER_DOMAIN}" is Resend's sandbox and ` +
        "does not work with Brevo. Set MAIL_FROM to the sender verified in Brevo."
    );
  }

  if (!config.appUrl) {
    console.warn(
      `${LOG_PREFIX} WARNING APP_URL (or CLIENT_ORIGIN / CLIENT_URL) is missing; ` +
        "password-reset, registration-verification, and appointment-reminder emails will be skipped."
    );
  }

  if (config.configured) {
    const sender = formatMailFrom({ name: config.senderName, email: config.senderEmail });
    console.info(
      `${LOG_PREFIX} provider=${config.provider} apiKey=${config.apiKeyName} present=true ` +
        `sender="${sender}" appUrl=${config.appUrl ?? "(none)"}`
    );
  } else {
    console.warn(
      `${LOG_PREFIX} WARNING email delivery is NOT configured. missing=` +
        `${[...config.missing, ...(config.appUrl ? [] : ["APP_URL"])].join(", ")}`
    );
  }
}

function getResendClient(apiKey) {
  if (!resendClient || resendClientKey !== apiKey) {
    resendClient = new Resend(apiKey);
    resendClientKey = apiKey;
  }
  return resendClient;
}

function truncate(value, maxLength = 600) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function sendViaResend({ apiKey, sender, to, subject, html, text, idempotencyKey, replyTo }) {
  const client = getResendClient(apiKey);
  const payload = {
    from: formatMailFrom(sender),
    to,
    subject,
    html,
    text,
  };
  if (replyTo) payload.replyTo = replyTo;

  // The Resend SDK reports many API failures in its resolved result instead of
  // throwing, so both shapes are converted into real errors.
  const result = idempotencyKey
    ? await client.emails.send(payload, { idempotencyKey })
    : await client.emails.send(payload);

  if (result?.error) {
    const error = new Error("Resend rejected the email.");
    Object.assign(
      error,
      safeEmailProviderFailure({
        providerCode: result.error.name || result.error.code,
        providerStatusCode: result.error.statusCode,
      }),
      { providerResponseBody: truncate(JSON.stringify(result.error)) }
    );
    throw error;
  }
  if (!result?.data?.id) {
    const error = new Error("Resend acceptance could not be confirmed.");
    error.providerCode = "acceptance_unconfirmed";
    throw error;
  }
  return { id: result.data.id };
}

async function sendViaBrevo({ apiKey, sender, to, toName, subject, html, text, replyTo }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: {
          name: sender.name || "MediGuide",
          email: sender.email,
        },
        to: [{ email: to, ...(toName ? { name: toName } : {}) }],
        subject,
        htmlContent: html,
        textContent: text,
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      }),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    let parsedBody = null;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
      const error = new Error(`Brevo rejected the email (HTTP ${response.status}).`);
      Object.assign(error, {
        providerCode:
          parsedBody?.code || (response.status >= 500 ? "provider_unavailable" : "provider_error"),
        providerStatusCode: response.status,
        // Logged only; callers surface a bounded code via safeEmailProviderFailure().
        providerResponseBody: truncate(rawBody || response.statusText),
      });
      throw error;
    }

    return { id: parsedBody?.messageId ?? "" };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`Brevo request timed out after ${BREVO_TIMEOUT_MS}ms.`);
      timeoutError.providerCode = "provider_timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send one transactional email through the configured provider.
 *
 * Resolves with `{ accepted: true, provider, id }`, or `{ skipped: true, reason }`
 * when the deployment is misconfigured (always logged as a WARNING — nothing is
 * ever skipped silently). A provider rejection throws an error carrying
 * `providerCode` / `providerStatusCode`.
 */
export async function sendEmail({
  to,
  toName = "",
  subject,
  html,
  text,
  idempotencyKey,
  replyTo,
} = {}) {
  const config = getEmailConfiguration();
  const recipient = String(to ?? "").trim();

  if (!config.providerSupported) {
    console.warn(
      `${LOG_PREFIX} WARNING skipped "${subject}": unsupported EMAIL_PROVIDER ` +
        `"${config.configuredProvider}".`
    );
    return { skipped: true, reason: "unsupported_provider" };
  }

  if (!config.apiKeyConfigured) {
    console.warn(
      `${LOG_PREFIX} WARNING skipped "${subject}": ${config.apiKeyName} is not set ` +
        `for provider "${config.provider}".`
    );
    return { skipped: true, reason: `missing_${config.apiKeyName}` };
  }

  if (!config.senderEmail) {
    console.warn(
      `${LOG_PREFIX} WARNING skipped "${subject}": MAIL_FROM is missing or could not be parsed.`
    );
    return { skipped: true, reason: "missing_MAIL_FROM" };
  }

  if (!recipient) {
    console.warn(`${LOG_PREFIX} WARNING skipped "${subject}": no recipient address was provided.`);
    return { skipped: true, reason: "missing_recipient" };
  }

  const sender = { name: config.senderName, email: config.senderEmail };
  const apiKey = readEnv(config.apiKeyName);

  try {
    const result =
      config.provider === "brevo"
        ? await sendViaBrevo({ apiKey, sender, to: recipient, toName, subject, html, text, replyTo })
        : await sendViaResend({
            apiKey,
            sender,
            to: recipient,
            subject,
            html,
            text,
            idempotencyKey,
            replyTo,
          });

    console.info(
      `${LOG_PREFIX} provider=${config.provider} accepted to="${recipient}" subject="${subject}"` +
        (result.id ? ` id=${result.id}` : "")
    );
    return { accepted: true, provider: config.provider, id: result.id };
  } catch (error) {
    const details = safeEmailProviderFailure(error);
    console.error(
      `${LOG_PREFIX} provider=${config.provider} FAILED to="${recipient}" subject="${subject}" ` +
        `code=${details.providerCode}` +
        (details.providerStatusCode ? ` status=${details.providerStatusCode}` : "") +
        ` body=${error?.providerResponseBody ?? truncate(error?.message)}`
    );
    throw error;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function displayDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function displayTime(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  const parsed = new Date(Date.UTC(2000, 0, 1, hours, minutes));
  return parsed.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

function detailRow(label, value) {
  return `<tr>
    <td style="padding:8px 0;color:#6b7280;font-size:14px;font-weight:600;width:130px;vertical-align:top;">${label}</td>
    <td style="padding:8px 0;color:#111827;font-size:14px;line-height:1.5;">${escapeHtml(value)}</td>
  </tr>`;
}

function normalizeAppUrl(value) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash
    ) {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function getPasswordResetAppUrl() {
  const configured = process.env.APP_URL?.trim();
  if (configured) return normalizeAppUrl(configured);

  // Most deployments already configure the frontend origin for CORS. Reuse it
  // for email links instead of silently disabling delivery when APP_URL is absent.
  const fallbackOrigins = (
    process.env.CLIENT_ORIGIN || process.env.CLIENT_URL || ""
  ).split(",");
  for (const origin of fallbackOrigins) {
    const normalized = normalizeAppUrl(origin.trim());
    if (normalized) return normalized;
  }
  return null;
}

/** True when the active provider has credentials plus a parseable sender. */
export function isEmailDeliveryConfigured() {
  return getEmailConfiguration().configured;
}

export function isPasswordResetEmailConfigured() {
  return isEmailDeliveryConfigured() && Boolean(getPasswordResetAppUrl());
}

export function isRegistrationVerificationEmailConfigured() {
  return isEmailDeliveryConfigured() && Boolean(getPasswordResetAppUrl());
}

export function isEmailOtpConfigured() {
  return isEmailDeliveryConfigured();
}

export function getMissingPasswordResetEmailConfiguration() {
  const config = getEmailConfiguration();
  const missing = [...config.missing];
  if (!config.appUrl) missing.push("APP_URL");
  return missing;
}

export function safeEmailProviderFailure(error) {
  const rawCode = error?.providerCode || error?.code || error?.name;
  const code = typeof rawCode === "string" && rawCode.length <= 32 &&
    /^[a-z][a-z0-9_-]*$/i.test(rawCode) && !/^[a-z0-9_-]{43}$/i.test(rawCode)
    ? rawCode
    : "provider_error";
  const statusCode = Number.isInteger(error?.providerStatusCode)
    ? error.providerStatusCode
    : Number.isInteger(error?.statusCode)
      ? error.statusCode
      : undefined;
  return { providerCode: code, ...(statusCode ? { providerStatusCode: statusCode } : {}) };
}

export async function sendPasswordResetEmail({ to, resetUrl, expiresInMinutes }) {
  const appUrl = getPasswordResetAppUrl();
  if (!appUrl) {
    console.warn(
      `${LOG_PREFIX} WARNING password reset email skipped: APP_URL (or CLIENT_ORIGIN / CLIENT_URL) is not configured.`
    );
    return { skipped: true, reason: "missing_APP_URL" };
  }
  const safeUrl = escapeHtml(resetUrl);
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;padding:32px;border:1px solid #dbe4ef;border-radius:16px;color:#142b4a"><h1 style="color:#1769aa">MediGuide</h1><h2>Reset your password</h2><p>We received a request to reset the password for your MediGuide account. Use the button below within ${expiresInMinutes} minutes.</p><p><a href="${safeUrl}" style="display:inline-block;background:#1769aa;color:white;padding:12px 20px;border-radius:10px;text-decoration:none">Reset password</a></p><p>If you did not request this, you can ignore this email.</p><p style="font-size:12px;color:#64748b">MediGuide is an educational demo. Use synthetic information only.</p></div>`;
  return sendEmail({
    to,
    subject: "Reset your MediGuide password",
    html,
    text: `Reset your MediGuide password within ${expiresInMinutes} minutes: ${resetUrl}\n\nIf you did not request this, ignore this email.`,
  });
}

export async function sendRegistrationVerificationEmail({
  to,
  token,
  expiresInHours,
}) {
  const appUrl = getPasswordResetAppUrl();
  if (!appUrl) {
    console.warn(
      `${LOG_PREFIX} WARNING registration verification email skipped: APP_URL (or CLIENT_ORIGIN / CLIENT_URL) is not configured.`
    );
    return { skipped: true, reason: "missing_APP_URL" };
  }

  const verificationUrl = new URL("/verify-email", appUrl);
  verificationUrl.searchParams.set("token", token);
  const safeUrl = escapeHtml(verificationUrl.toString());
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;padding:32px;border:1px solid #dbe4ef;border-radius:16px;color:#142b4a"><h1 style="color:#1769aa">MediGuide</h1><h2>Verify your email address</h2><p>Confirm your email address to activate your MediGuide account. This link expires in ${expiresInHours} hours.</p><p><a href="${safeUrl}" style="display:inline-block;background:#1769aa;color:white;padding:12px 20px;border-radius:10px;text-decoration:none">Verify email</a></p><p>If you did not create this account, you can ignore this email.</p><p style="font-size:12px;color:#64748b">MediGuide is an educational demo. Use synthetic information only.</p></div>`;

  return sendEmail({
    to,
    subject: "Verify your MediGuide email address",
    html,
    text: `Verify your MediGuide email address within ${expiresInHours} hours: ${verificationUrl}\n\nIf you did not create this account, ignore this email.`,
  });
}

export async function sendEmailOtp({ to, code, expiresInMinutes }) {
  const action = "sign in to MediGuide";
  const heading = "Your sign-in code";
  const subject = "Your MediGuide sign-in code";
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;padding:32px;border:1px solid #dbe4ef;border-radius:16px;color:#142b4a"><h1 style="color:#1769aa">MediGuide</h1><h2>${heading}</h2><p>Use this one-time code to ${action}. It expires in ${expiresInMinutes} minutes.</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#1769aa">${code}</p><p>If you did not request this code, you can ignore this email.</p><p style="font-size:12px;color:#64748b">MediGuide is an educational demo. Use synthetic information only.</p></div>`;
  return sendEmail({
    to,
    subject,
    html,
    text: `Your MediGuide code to ${action} is ${code}. It expires in ${expiresInMinutes} minutes.\n\nIf you did not request this code, ignore this email.`,
  });
}

export function isAppointmentReminderEmailConfigured() {
  return isEmailDeliveryConfigured() && Boolean(getPasswordResetAppUrl());
}

export async function sendAppointmentReminder({ to, appointment, offsetMinutes, idempotencyKey }) {
  const appUrl = getPasswordResetAppUrl();
  if (!appUrl) {
    console.warn(
      `${LOG_PREFIX} WARNING appointment reminder skipped: APP_URL (or CLIENT_ORIGIN / CLIENT_URL) is not configured.`
    );
    return { skipped: true, reason: "missing_APP_URL" };
  }
  const startsAt = appointmentDateTimeToUtc(appointment.date, appointment.time, appointment.timeZone);
  const formattedWhen = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: appointment.timeZone,
  }).format(startsAt);
  const hospital = appointment.hospital?.name || "your selected hospital";
  const address = [appointment.hospital?.address, appointment.hospital?.city, appointment.hospital?.state]
    .filter(Boolean)
    .join(", ");
  const period = offsetMinutes % 1440 === 0
    ? `${offsetMinutes / 1440} day${offsetMinutes === 1440 ? "" : "s"}`
    : offsetMinutes % 60 === 0
      ? `${offsetMinutes / 60} hour${offsetMinutes === 60 ? "" : "s"}`
      : `${offsetMinutes} minutes`;
  const appointmentsUrl = `${appUrl}/appointments`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;padding:32px;border:1px solid #dbe4ef;border-radius:16px;color:#142b4a"><h1 style="color:#1769aa">MediGuide appointment reminder</h1><p>Your appointment is coming up in ${period}.</p><p><strong>${escapeHtml(appointment.doctor)}</strong>${appointment.specialty ? ` · ${escapeHtml(appointment.specialty)}` : ""}<br>${escapeHtml(formattedWhen)}<br>${escapeHtml(hospital)}${address ? `<br>${escapeHtml(address)}` : ""}</p><p><a href="${escapeHtml(appointmentsUrl)}">View your appointments</a></p><p style="font-size:12px;color:#64748b">MediGuide is an educational demo. This is not a clinical reminder service.</p></div>`;
  return sendEmail({
    to,
    subject: "MediGuide appointment reminder",
    html,
    text: `Your appointment is coming up in ${period}.\n${appointment.doctor}${appointment.specialty ? ` · ${appointment.specialty}` : ""}\n${formattedWhen}\n${hospital}${address ? `, ${address}` : ""}\nView your appointments: ${appointmentsUrl}\n\nMediGuide is an educational demo, not a clinical reminder service.`,
    idempotencyKey,
  });
}

/**
 * Sends a demo appointment-saved notification to the session-derived patient
 * email. Delivery requires RESEND_API_KEY and a MAIL_FROM sender on a verified
 * Resend domain. Missing keys skip delivery; failures never affect booking.
 */
export async function sendAppointmentConfirmation({
  to,
  patientName,
  doctor,
  specialty,
  hospital,
  date,
  time,
  reason,
}) {
  const formattedDate = displayDate(date);
  const formattedTime = displayTime(time);
  const hospitalLocation = hospital
    ? [hospital.address, hospital.city, hospital.state].filter(Boolean).join(", ")
    : "";

  const detailRows = [
    detailRow("Doctor", doctor),
    detailRow("Specialty", specialty),
    hospital?.name ? detailRow("Hospital", hospital.name) : "",
    hospitalLocation ? detailRow("Hospital location", hospitalLocation) : "",
    detailRow("Date", formattedDate),
    detailRow("Time", formattedTime),
    reason ? detailRow("Reason", reason) : "",
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Appointment Saved</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
          <tr>
            <td style="background:linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">MediGuide</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Your Demo Appointment is Saved</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 8px;color:#374151;font-size:16px;">Hi <strong>${escapeHtml(patientName)}</strong>,</p>
              <p style="margin:0 0 28px;color:#6b7280;font-size:14px;line-height:1.6;">
                Your demo appointment has been saved in MediGuide. Here are the details:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:28px;">
                <tr>
                  <td>
                    <table width="100%" cellpadding="0" cellspacing="0">${detailRows}</table>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
                You can review or cancel this demo record from your MediGuide dashboard.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
                © ${new Date().getFullYear()} MediGuide · Educational demo only. This email does not confirm a real doctor or hospital appointment.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${patientName},`,
    "",
    "Your demo appointment has been saved in MediGuide.",
    `Doctor: ${doctor}`,
    `Specialty: ${specialty}`,
    hospital?.name ? `Hospital: ${hospital.name}` : "",
    hospitalLocation ? `Hospital location: ${hospitalLocation}` : "",
    `Date: ${formattedDate}`,
    `Time: ${formattedTime}`,
    reason ? `Reason: ${reason}` : "",
    "",
    "Educational demo only. This is not a real doctor or hospital appointment confirmation.",
  ].filter((line) => line !== "").join("\n");

  return sendEmail({
    to,
    toName: patientName,
    subject: "Appointment Saved – MediGuide Demo",
    html,
    text,
  });
}

/**
 * Cancellation notice for a demo appointment.
 *
 * Sent fire-and-forget from the cancel endpoint: the cancellation is already
 * committed, so a provider outage must never fail the request. Delivery uses the
 * configured provider (Brevo or Resend) exactly like every other notification.
 */
export async function sendAppointmentCancellation({
  to,
  patientName,
  doctor,
  specialty,
  hospital,
  date,
  time,
  reason,
}) {
  const formattedDate = displayDate(date);
  const formattedTime = displayTime(time);
  const hospitalLocation = hospital
    ? [hospital.address, hospital.city, hospital.state].filter(Boolean).join(", ")
    : "";

  const detailRows = [
    detailRow("Doctor", doctor),
    detailRow("Specialty", specialty),
    hospital?.name ? detailRow("Hospital", hospital.name) : "",
    hospitalLocation ? detailRow("Hospital location", hospitalLocation) : "",
    detailRow("Was scheduled for", `${formattedDate} at ${formattedTime}`),
    reason ? detailRow("Reason", reason) : "",
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Appointment Cancelled</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
          <tr>
            <td style="background:linear-gradient(135deg,#b91c1c 0%,#7f1d1d 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">MediGuide</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Your Demo Appointment Was Cancelled</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 8px;color:#374151;font-size:16px;">Hi <strong>${escapeHtml(patientName)}</strong>,</p>
              <p style="margin:0 0 28px;color:#6b7280;font-size:14px;line-height:1.6;">
                This demo appointment has been cancelled as requested. No further reminders will be sent for it.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:28px;">
                <tr>
                  <td>
                    <table width="100%" cellpadding="0" cellspacing="0">${detailRows}</table>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
                You can book a new appointment at any time from your MediGuide dashboard.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
                © ${new Date().getFullYear()} MediGuide · Educational demo only. This email does not cancel a real doctor or hospital appointment.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${patientName},`,
    "",
    "This demo appointment has been cancelled as requested.",
    `Doctor: ${doctor}`,
    `Specialty: ${specialty}`,
    hospital?.name ? `Hospital: ${hospital.name}` : "",
    hospitalLocation ? `Hospital location: ${hospitalLocation}` : "",
    `Was scheduled for: ${formattedDate} at ${formattedTime}`,
    reason ? `Reason: ${reason}` : "",
    "",
    "No further reminders will be sent for it.",
    "Educational demo only. This is not a real doctor or hospital appointment.",
  ].filter((line) => line !== "").join("\n");

  return sendEmail({
    to,
    toName: patientName,
    subject: "Appointment Cancelled – MediGuide Demo",
    html,
    text,
  });
}
