import { z } from "zod";

const fullName = z
  .string()
  .trim()
  .min(2, "Full name must contain at least 2 characters")
  .max(80, "Full name must contain no more than 80 characters");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254, "Email address is too long");

const password = z
  .string()
  .min(8, "Password must contain at least 8 characters")
  .max(72, "Password must contain no more than 72 characters")
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must contain no more than 72 UTF-8 bytes",
  });

const optionalText = (maxLength) =>
  z.string().trim().max(maxLength).optional();

const phoneNumber = z
  .string()
  .trim()
  .max(20, "Phone number must contain no more than 20 characters")
  .refine((value) => !value || /^[+()\d\s.-]{7,20}$/.test(value), {
    message: "Enter a valid phone number or leave it blank",
  })
  .optional();

const stringList = (maxItems, maxLength) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems).optional();

function isEmptyOrCalendarDate(value) {
  if (!value) return true;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export const registerSchema = z
  .object({
    fullName,
    email,
    password,
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z
      .string()
      .min(1, "Password is required")
      .max(72, "Password must contain no more than 72 characters")
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
        message: "Password must contain no more than 72 UTF-8 bytes",
      }),
  })
  .strict();

export const forgotPasswordSchema = z.object({ email }).strict();

export const resetPasswordSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Reset link is invalid or expired"),
  password,
}).strict();

export const verifyEmailSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Verification link is invalid or expired"),
}).strict();

export const profileSchema = z
  .object({
    fullName: fullName.optional(),
    email: email.optional(),
    dob: z
      .string()
      .regex(/^(?:\d{4}-\d{2}-\d{2})?$/, "Date of birth must use YYYY-MM-DD")
      .refine(isEmptyOrCalendarDate, "Enter a valid date of birth")
      .optional(),
    phone: phoneNumber,
    city: optionalText(80),
    state: optionalText(80),
    address: optionalText(240),
    bloodType: z
      .enum(["", "Unknown", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])
      .optional(),
    allergies: stringList(20, 80),
    medications: stringList(30, 160),
    emergencyName: optionalText(80),
    relationship: optionalText(60),
    emergencyPhone: optionalText(40),
    emergencyAddress: optionalText(240),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one profile field to update",
  });

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: result.error.issues[0]?.message || "Invalid request data",
      });
    }

    req.body = result.data;
    return next();
  };
}
