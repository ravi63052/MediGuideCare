import assert from "node:assert/strict";
import test from "node:test";

import Appointment from "../src/models/Appointment.js";
import { appointmentSchema } from "../src/validators/appointmentValidator.js";
import { isWithinCancellationWindow } from "../src/services/appointmentLifecycle.js";

const validBooking = {
  doctor: "Dr. Example",
  specialty: "General Physician",
  hospital: {
    id: "hospital-1",
    name: "Example Hospital",
    address: "",
    city: "Pune",
    state: "Maharashtra",
    source: "OpenStreetMap",
    sourceUrl: "https://www.openstreetmap.org/",
    location: { type: "Point", coordinates: [73.8567, 18.5204] },
  },
  date: "2026-11-02",
  time: "10:00",
};

test("appointment times must use 15-minute increments", () => {
  assert.equal(appointmentSchema.safeParse(validBooking).success, true);
  assert.equal(appointmentSchema.safeParse({ ...validBooking, time: "10:07" }).success, false);
});

test("upcoming doctor/date/time slots are uniquely reserved", () => {
  const slotIndex = Appointment.schema.indexes().find(([keys, options]) =>
    keys.doctor === 1 &&
    keys.date === 1 &&
    keys.time === 1 &&
    options.unique === true
  );

  assert.ok(slotIndex);
  assert.deepEqual(slotIndex[1].partialFilterExpression, { status: "Upcoming" });
});

test("cancellation is blocked inside the one-hour notice window", () => {
  const now = new Date("2026-11-02T03:30:00.000Z");
  const appointment = {
    date: "2026-11-02",
    time: "10:00",
    timeZone: "Asia/Kolkata",
  };

  assert.equal(isWithinCancellationWindow(appointment, now), false);
  assert.equal(
    isWithinCancellationWindow(appointment, new Date("2026-11-02T03:30:01.000Z")),
    true
  );
});
