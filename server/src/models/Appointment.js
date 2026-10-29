import mongoose from "mongoose";

const hospitalLocationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Point"],
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length === 2 &&
            Number.isFinite(value[0]) &&
            Number.isFinite(value[1]) &&
            Math.abs(value[0]) <= 180 &&
            Math.abs(value[1]) <= 90
          );
        },
        message: "Hospital coordinates must contain valid longitude and latitude",
      },
    },
  },
  { _id: false }
);

const hospitalSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true, maxlength: 200 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    address: { type: String, default: "", trim: true, maxlength: 1000 },
    city: { type: String, default: "", trim: true, maxlength: 120 },
    state: { type: String, default: "", trim: true, maxlength: 120 },
    source: {
      type: String,
      enum: ["OpenStreetMap", "Google Places"],
      required: true,
    },
    sourceUrl: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2048,
      validate: {
        validator(value) {
          try {
            const url = new URL(value);
            return url.protocol === "https:" || url.protocol === "http:";
          } catch {
            return false;
          }
        },
        message: "Hospital source URL must use HTTP or HTTPS",
      },
    },
    location: { type: hospitalLocationSchema, required: true },
  },
  { _id: false }
);

const reminderSchema = new mongoose.Schema({
  offsetMinutes: { type: Number, enum: [1440, 120, 60, 30], required: true },
  scheduledAt: { type: Date, required: true },
  status: {
    type: String,
    enum: ["scheduled", "processing", "processed", "cancelled"],
    default: "scheduled",
  },
  inAppStatus: {
    type: String,
    enum: ["pending", "delivered", "cancelled"],
    default: "pending",
  },
  emailStatus: {
    type: String,
    enum: ["pending", "sending", "accepted", "failed", "unconfigured", "unknown", "cancelled"],
    default: "pending",
  },
  emailErrorCode: { type: String, default: "", maxlength: 48 },
  emailAttemptedAt: { type: Date, default: null },
  emailAcceptedAt: { type: Date, default: null },
  leaseUntil: { type: Date, default: null },
});

const readinessChecklistSchema = new mongoose.Schema(
  {
    bringDocuments: { type: Boolean, default: false },
    prepareQuestions: { type: Boolean, default: false },
    confirmTransport: { type: Boolean, default: false },
    arriveEarly: { type: Boolean, default: false },
  },
  { _id: false }
);

const reminderPreferencesSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    offsetsMinutes: { type: [Number], default: [1440, 120] },
  },
  { _id: false }
);

const appointmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    patientName: {
      type: String,
      required: [true, "Patient name is required"],
      trim: true,
      maxlength: 80,
    },
    patientEmail: {
      type: String,
      required: [true, "Patient email is required"],
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    doctor: {
      type: String,
      required: [true, "Doctor name is required"],
      trim: true,
      maxlength: 120,
    },
    specialty: {
      type: String,
      required: [true, "Specialty is required"],
      trim: true,
      maxlength: 120,
    },
    // Optional at the database level so appointments created before hospital
    // selection was introduced remain valid. New requests require it in Zod.
    hospital: { type: hospitalSnapshotSchema, required: false },
    date: {
      type: String,
      required: [true, "Appointment date is required"],
      match: [/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"],
    },
    time: {
      type: String,
      required: [true, "Appointment time is required"],
      match: [/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:mm format"],
    },
    timeZone: { type: String, default: "Asia/Kolkata", trim: true, maxlength: 80 },
    reminderPreferences: { type: reminderPreferencesSchema, default: () => ({}) },
    reminders: { type: [reminderSchema], default: [] },
    remindersInitialized: { type: Boolean, default: false },
    readinessChecklist: { type: readinessChecklistSchema, default: () => ({}) },
    reason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["Upcoming", "Completed", "Cancelled"],
      default: "Upcoming",
    },
    // Set when the lifecycle sweep promotes a finished appointment to Completed.
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

appointmentSchema.index({ userId: 1, date: 1, time: 1 });
appointmentSchema.index(
  { doctor: 1, date: 1, time: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "Upcoming" },
    name: "unique_upcoming_doctor_slot",
  }
);
appointmentSchema.index({ status: 1, "reminders.status": 1, "reminders.scheduledAt": 1 });
// Supports the completion sweep (status + date) and per-user lookups.
appointmentSchema.index({ status: 1, date: 1 });

export default mongoose.model("Appointment", appointmentSchema);
