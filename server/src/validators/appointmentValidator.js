import { z } from "zod";

import { validateBody } from "./authValidator.js";
import { SUPPORTED_REMINDER_OFFSETS, validateTimeZone } from "../services/appointmentReminders.js";

export { validateBody };

function isCalendarDate(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

const hospitalSourceUrl = z
  .string()
  .trim()
  .url("Hospital source URL is invalid")
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  }, "Hospital source URL must use HTTP or HTTPS");

const hospitalSnapshotSchema = z
  .object(
    {
      id: z.string().trim().min(1).max(200),
      name: z.string().trim().min(2).max(200),
      address: z.string().trim().max(1000).default(""),
      city: z.string().trim().max(120).default(""),
      state: z.string().trim().max(120).default(""),
      source: z.enum(["OpenStreetMap", "Google Places"]),
      sourceUrl: hospitalSourceUrl,
      location: z
        .object({
          type: z.literal("Point"),
          coordinates: z.tuple([
            z.number().finite().min(-180).max(180),
            z.number().finite().min(-90).max(90),
          ]),
        })
        .strict(),
    },
    { required_error: "Select a hospital location for the appointment" }
  )
  .strict();

export const appointmentSchema = z
  .object({
    doctor: z.string().trim().min(2).max(120),
    specialty: z.string().trim().min(2).max(120),
    hospital: hospitalSnapshotSchema,
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD")
      .refine(isCalendarDate, "Enter a valid calendar date"),
    time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Time must use 24-hour HH:mm")
      .refine((value) => Number(value.slice(3)) % 15 === 0, "Appointment time must use 15-minute increments"),
    timeZone: z.string().trim().min(1).max(80).refine(validateTimeZone, "Select a valid timezone").default("Asia/Kolkata"),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const validateAppointment = validateBody(appointmentSchema);

export const reminderPreferencesSchema = z.object({
  enabled: z.boolean(),
  offsetsMinutes: z.array(z.number().int().refine((value) => SUPPORTED_REMINDER_OFFSETS.includes(value)))
    .max(SUPPORTED_REMINDER_OFFSETS.length)
    .refine((values) => new Set(values).size === values.length, "Select each reminder timing once"),
}).strict().refine((value) => !value.enabled || value.offsetsMinutes.length > 0, {
  message: "Choose at least one timing or turn reminders off",
});

export const readinessChecklistSchema = z.object({
  bringDocuments: z.boolean(),
  prepareQuestions: z.boolean(),
  confirmTransport: z.boolean(),
  arriveEarly: z.boolean(),
}).strict();
