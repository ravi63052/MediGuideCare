import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  getEmailConfiguration,
  getEmailHealth,
  getEmailProvider,
  getMissingPasswordResetEmailConfiguration,
  isAppointmentReminderEmailConfigured,
  isPasswordResetEmailConfigured,
  isRegistrationVerificationEmailConfigured,
  logEmailConfiguration,
  parseMailFrom,
  sendEmail,
} from "../src/services/emailService.js";

const ENV_KEYS = [
  "EMAIL_PROVIDER",
  "BREVO_API_KEY",
  "RESEND_API_KEY",
  "MAIL_FROM",
  "APP_URL",
  "CLIENT_ORIGIN",
  "CLIENT_URL",
];
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const realFetch = globalThis.fetch;

function clearEmailEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
}

beforeEach(() => {
  clearEmailEnv();
  globalThis.fetch = realFetch;
});

afterEach(() => {
  restoreEnv();
  globalThis.fetch = realFetch;
});

test("EMAIL_PROVIDER defaults to resend and rejects unknown values", () => {
  assert.equal(getEmailProvider(), "resend");

  process.env.EMAIL_PROVIDER = "Brevo";
  assert.equal(getEmailProvider(), "brevo");

  process.env.EMAIL_PROVIDER = "mailgun";
  assert.equal(getEmailProvider(), "resend");
  assert.equal(getEmailConfiguration().providerSupported, false);
});

test("MAIL_FROM accepts named, quoted, and bare formats", () => {
  assert.deepEqual(parseMailFrom("MediGuide <vicky@example.com>"), {
    name: "MediGuide",
    email: "vicky@example.com",
  });
  assert.deepEqual(parseMailFrom('"MediGuide Care" <Vicky@Example.com>'), {
    name: "MediGuide Care",
    email: "vicky@example.com",
  });
  assert.deepEqual(parseMailFrom("vicky@example.com"), { name: "", email: "vicky@example.com" });
  assert.deepEqual(parseMailFrom('"vicky@example.com"'), { name: "", email: "vicky@example.com" });
  assert.deepEqual(parseMailFrom("not an address"), { name: "", email: "" });
  assert.deepEqual(parseMailFrom(""), { name: "", email: "" });
});

test("configuration reports the provider-specific API key name without leaking it", () => {
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-secret-value";
  process.env.MAIL_FROM = "MediGuide <vicky@example.com>";
  process.env.APP_URL = "https://medi-guide-care.vercel.app";

  const config = getEmailConfiguration();
  assert.equal(config.provider, "brevo");
  assert.equal(config.apiKeyName, "BREVO_API_KEY");
  assert.equal(config.apiKeyConfigured, true);
  assert.equal(config.senderEmail, "vicky@example.com");
  assert.equal(config.senderName, "MediGuide");
  assert.equal(config.senderDomain, "example.com");
  assert.equal(config.sandboxSender, false);
  assert.equal(config.senderVerified, true);
  assert.deepEqual(config.missing, []);
  assert.equal(JSON.stringify(config).includes("xkeysib-secret-value"), false);
});

test("brevo without an API key is reported as unconfigured, not crashed", () => {
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.MAIL_FROM = "MediGuide <vicky@example.com>";
  process.env.APP_URL = "https://medi-guide-care.vercel.app";

  const config = getEmailConfiguration();
  assert.equal(config.configured, false);
  assert.deepEqual(config.missing, ["BREVO_API_KEY"]);
  assert.equal(isPasswordResetEmailConfigured(), false);
  assert.equal(isRegistrationVerificationEmailConfigured(), false);
  assert.equal(isAppointmentReminderEmailConfigured(), false);
  assert.deepEqual(getMissingPasswordResetEmailConfiguration(), ["BREVO_API_KEY"]);
});

test("switching to brevo stops requiring RESEND_API_KEY", () => {
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.MAIL_FROM = "MediGuide <vicky@example.com>";
  process.env.APP_URL = "https://medi-guide-care.vercel.app";

  assert.equal(isPasswordResetEmailConfigured(), true);
  assert.equal(isRegistrationVerificationEmailConfigured(), true);
  assert.equal(isAppointmentReminderEmailConfigured(), true);
  assert.deepEqual(getMissingPasswordResetEmailConfiguration(), []);
});

test("a resend.dev sender is flagged as the sandbox and invalid for brevo", () => {
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.MAIL_FROM = "MediGuide <onboarding@resend.dev>";

  const config = getEmailConfiguration();
  assert.equal(config.sandboxSender, true);
  assert.equal(config.senderVerified, false);
});

test("health payload stays secret-free and reports the sender", () => {
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-super-secret";
  process.env.MAIL_FROM = "MediGuide <vicky@example.com>";
  process.env.APP_URL = "https://medi-guide-care.vercel.app";

  const health = getEmailHealth();

  assert.equal(health.provider, "brevo");
  assert.equal(health.apiKeyConfigured, true);
  assert.equal(health.senderEmail, "vicky@example.com");
  assert.equal(health.senderVerified, true);
  assert.equal(health.appUrlConfigured, true);
  assert.equal(JSON.stringify(health).includes("xkeysib-super-secret"), false);
  assert.deepEqual(Object.keys(health).sort(), [
    "apiKeyConfigured",
    "appUrlConfigured",
    "missingConfiguration",
    "provider",
    "sandboxSender",
    "senderDomain",
    "senderEmail",
    "senderName",
    "senderVerified",
  ]);
});

test("sendEmail reports a loud skip instead of throwing when unconfigured", async () => {
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.MAIL_FROM = "MediGuide <vicky@example.com>";

  const result = await sendEmail({ to: "patient@example.com", subject: "Test", html: "<p>x</p>", text: "x" });

  assert.deepEqual(result, { skipped: true, reason: "missing_BREVO_API_KEY" });
});

test("sendEmail skips when MAIL_FROM cannot be parsed", async () => {
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.MAIL_FROM = "nonsense";

  const result = await sendEmail({ to: "patient@example.com", subject: "Test", html: "<p>x</p>", text: "x" });
  assert.deepEqual(result, { skipped: true, reason: "missing_MAIL_FROM" });
});

test("sendEmail posts the documented Brevo payload and returns the message id", async () => {
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.MAIL_FROM = '"MediGuide" <vicky@example.com>';

  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ messageId: "<abc@brevo>" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await sendEmail({
    to: "patient@example.com",
    toName: "Patient One",
    subject: "Appointment Saved",
    html: "<p>hello</p>",
    text: "hello",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.provider, "brevo");
  assert.equal(result.id, "<abc@brevo>");

  assert.equal(captured.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["api-key"], "xkeysib-test");
  assert.equal(captured.init.headers["Content-Type"], "application/json");

  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.sender, { name: "MediGuide", email: "vicky@example.com" });
  assert.deepEqual(body.to, [{ email: "patient@example.com", name: "Patient One" }]);
  assert.equal(body.subject, "Appointment Saved");
  assert.equal(body.htmlContent, "<p>hello</p>");
  assert.equal(body.textContent, "hello");
});

test("sendEmail throws with the provider code and status on a Brevo rejection", async () => {
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.MAIL_FROM = "MediGuide <vicky@example.com>";

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ code: "unauthorized", message: "Key not found" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );

  await assert.rejects(
    () => sendEmail({ to: "patient@example.com", subject: "Nope", html: "<p>x</p>", text: "x" }),
    (error) => {
      assert.equal(error.providerStatusCode, 401);
      assert.equal(error.providerCode, "unauthorized");
      assert.match(error.providerResponseBody, /Key not found/);
      return true;
    },
  );
});

test("startup diagnostics never print the API key", () => {
  process.env.EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-should-not-appear";
  process.env.MAIL_FROM = "MediGuide <vicky@example.com>";
  process.env.APP_URL = "https://medi-guide-care.vercel.app";

  const lines = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = (...args) => lines.push(args.join(" "));
  console.warn = (...args) => lines.push(args.join(" "));

  try {
    logEmailConfiguration();
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }

  const output = lines.join("\n");
  assert.match(output, /provider=brevo/);
  assert.match(output, /apiKey=BREVO_API_KEY/);
  assert.equal(output.includes("xkeysib-should-not-appear"), false);
});
