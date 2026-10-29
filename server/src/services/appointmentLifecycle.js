import Appointment from "../models/Appointment.js";
import { appointmentDateTimeToUtc } from "./appointmentReminders.js";

/**
 * Appointment status lifecycle.
 *
 * Bookings are created as "Upcoming" and can be "Cancelled" by the patient. The
 * "Completed" state was previously never applied, so finished appointments kept
 * showing an "Upcoming" badge forever. This module is the single place that
 * decides when an appointment is over and settles the stored status.
 *
 * An appointment is considered finished once its start time plus a standard
 * visit duration has passed. The duration is configurable because the booking
 * form does not collect one:
 *   APPOINTMENT_DURATION_MINUTES=30   (default, 0-480 accepted)
 */

export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
export const APPOINTMENT_CANCELLATION_NOTICE_MINUTES = 60;
const MAX_APPOINTMENT_DURATION_MINUTES = 480;
const DAY_MS = 24 * 60 * 60 * 1000;

export function getAppointmentDurationMinutes(env = process.env) {
  const configured = Number(env.APPOINTMENT_DURATION_MINUTES);

  if (
    !Number.isFinite(configured) ||
    configured < 0 ||
    configured > MAX_APPOINTMENT_DURATION_MINUTES
  ) {
    return DEFAULT_APPOINTMENT_DURATION_MINUTES;
  }
  return configured;
}

/** UTC instant at which the appointment is over (start + duration). */
export function getAppointmentEndTime(
  { date, time, timeZone } = {},
  durationMinutes = getAppointmentDurationMinutes()
) {
  const startsAt = appointmentDateTimeToUtc(date, time, timeZone || "Asia/Kolkata");
  return new Date(startsAt.getTime() + durationMinutes * 60_000);
}

/** True when an appointment starts too soon to be cancelled. */
export function isWithinCancellationWindow(appointment, now = new Date()) {
  const startsAt = appointmentDateTimeToUtc(
    appointment.date,
    appointment.time,
    appointment.timeZone || "Asia/Kolkata"
  );
  return startsAt.getTime() - now.getTime() < APPOINTMENT_CANCELLATION_NOTICE_MINUTES * 60_000;
}

/** True when an "Upcoming" appointment has already ended. */
export function isAppointmentFinished(
  appointment,
  now = new Date(),
  durationMinutes = getAppointmentDurationMinutes()
) {
  if (!appointment?.date || !appointment?.time) return false;
  if (appointment.status && appointment.status !== "Upcoming") return false;

  try {
    return getAppointmentEndTime(appointment, durationMinutes).getTime() <= now.getTime();
  } catch {
    // An unparseable date/time (or a time that does not exist in the stored
    // timezone) must never block the status of other appointments.
    return false;
  }
}

function utcDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Promote finished appointments from "Upcoming" to "Completed".
 *
 * Called from GET /api/appointments (per user, so the list is always correct
 * even if the background scheduler was asleep) and from the reminder scheduler
 * tick (all users, so reminders stop even if nobody opens the app).
 *
 * @returns {Promise<number>} number of appointments transitioned
 */
export async function completeFinishedAppointments({
  now = new Date(),
  userId = null,
  model = Appointment,
} = {}) {
  const durationMinutes = getAppointmentDurationMinutes();

  // Only appointments dated today or earlier can have finished. One extra day of
  // slack keeps timezones ahead of UTC correct; the exact end time is then
  // verified per appointment below, so nothing is completed early.
  const bound = utcDateString(new Date(now.getTime() + DAY_MS));
  const query = { status: "Upcoming", date: { $lte: bound } };
  if (userId) query.userId = userId;

  const candidates = await model
    .find(query)
    .select("_id date time timeZone status")
    .lean();

  const finishedIds = candidates
    .filter((appointment) => isAppointmentFinished(appointment, now, durationMinutes))
    .map((appointment) => appointment._id);

  if (!finishedIds.length) return 0;

  const result = await model.updateMany(
    // The status guard keeps a concurrent cancellation from being overwritten.
    { _id: { $in: finishedIds }, status: "Upcoming" },
    {
      $set: {
        status: "Completed",
        completedAt: now,
        // A finished appointment has nothing left to remind the patient about.
        "reminders.$[reminder].status": "cancelled",
        "reminders.$[reminder].inAppStatus": "cancelled",
        "reminders.$[reminder].emailStatus": "cancelled",
      },
    },
    {
      arrayFilters: [
        {
          "reminder.status": { $in: ["scheduled", "processing"] },
          "reminder.emailStatus": "pending",
        },
      ],
    }
  );

  const completed = result?.modifiedCount ?? 0;
  if (completed > 0) {
    console.info(
      `[appointments] marked ${completed} finished appointment(s) as Completed` +
        (userId ? " for one patient" : "")
    );
  }
  return completed;
}
