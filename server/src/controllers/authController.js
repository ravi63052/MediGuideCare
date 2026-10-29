import bcrypt from "bcryptjs";

import User from "../models/User.js";
import ProfilePhoto from "../models/ProfilePhoto.js";
import { clearSession, createSession } from "../utils/session.js";
import { completePasswordReset, createPasswordResetToken, PASSWORD_RESET_EXPIRY_MS } from "../services/passwordResetService.js";
import {
  createEmailOtp,
  EMAIL_OTP_EXPIRY_MS,
} from "../services/emailOtpService.js";
import {
  completeRegistrationVerification,
  createRegistrationVerificationToken,
  REGISTRATION_VERIFICATION_EXPIRY_MS,
} from "../services/registrationVerificationService.js";
import {
  getMissingPasswordResetEmailConfiguration,
  getPasswordResetAppUrl,
  isEmailOtpConfigured,
  isPasswordResetEmailConfigured,
  isRegistrationVerificationEmailConfigured,
  safeEmailProviderFailure,
  sendEmailOtp,
  sendPasswordResetEmail,
  sendRegistrationVerificationEmail,
} from "../services/emailService.js";

const BCRYPT_ROUNDS = 12;
const RESET_REQUEST_MESSAGE = "If an account exists for that email and email delivery is available, reset instructions may be sent.";
// Make unknown-email logins perform a comparable bcrypt operation.
const DUMMY_PASSWORD_HASH =
  "$2b$12$ldgVALHVd3.ALLIk0g763..jNyVmTORREW7mR2TooS8tki310MB6m";

function publicUser(user) {
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    role: user.role?.toLowerCase() || "patient",
    profilePhotoUpdatedAt: user.profilePhotoUpdatedAt?.toISOString?.() || null,
    dob: user.dob || "",
    phone: user.phone || "",
    city: user.city || "",
    state: user.state || "",
    address: user.address || "",
    bloodType: user.bloodType || "",
    allergies: Array.isArray(user.allergies) ? [...user.allergies] : [],
    medications: Array.isArray(user.medications) ? [...user.medications] : [],
    emergencyName: user.emergencyName || "",
    relationship: user.relationship || "",
    emergencyPhone: user.emergencyPhone || "",
    emergencyAddress: user.emergencyAddress || "",
  };
}

function sniffProfilePhotoType(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

function validateProfilePhoto(file, res) {
  if (!file?.buffer?.length) {
    res.status(400).json({ message: "Choose a profile photo to upload." });
    return "";
  }
  const actualType = sniffProfilePhotoType(file.buffer);
  if (!actualType || actualType !== file.mimetype) {
    res.status(400).json({ message: "The selected file is not a valid JPG, PNG, or WebP image." });
    return "";
  }
  return actualType;
}

export async function register(req, res, next) {
  try {
    if (!isRegistrationVerificationEmailConfigured()) {
      return res.status(503).json({
        message: "Email verification is temporarily unavailable. Please try again later.",
      });
    }

    const { fullName, email, password } = req.body;
    let user = await User.findOne({ email });
    if (user?.emailVerified) {
      return res.status(409).json({
        message: "An account with this email already exists. Try signing in instead.",
      });
    }

    const { token, tokenHash } = createRegistrationVerificationToken();
    const expiresAt = new Date(Date.now() + REGISTRATION_VERIFICATION_EXPIRY_MS);

    if (user) {
      const update = await User.updateOne(
        { _id: user._id, emailVerified: false },
        {
          $set: {
            fullName,
            passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
            emailVerificationTokenHash: tokenHash,
            emailVerificationTokenExpiresAt: expiresAt,
            emailOtpHash: null,
            emailOtpExpiresAt: null,
            emailOtpPurpose: null,
          },
        },
      );
      if (update.matchedCount !== 1) {
        return res.status(409).json({
          message: "An account with this email already exists. Try signing in instead.",
        });
      }
    } else {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      user = await User.create({
        fullName,
        email,
        passwordHash,
        role: "patient",
        emailVerified: false,
        emailVerificationTokenHash: tokenHash,
        emailVerificationTokenExpiresAt: expiresAt,
      });
    }

    try {
      const delivery = await sendRegistrationVerificationEmail({
        to: user.email,
        token,
        expiresInHours: REGISTRATION_VERIFICATION_EXPIRY_MS / (60 * 60 * 1000),
      });
      if (!delivery.accepted) {
        return res.status(503).json({
          message: "We could not send your verification link. Please try again later.",
        });
      }
    } catch (error) {
      console.warn("Registration verification email delivery failed.", safeEmailProviderFailure(error));
      return res.status(503).json({
        message: "We could not send your verification link. Please try again later.",
      });
    }

    return res.status(202).json({
      message: "A verification link was sent to your email address. Open it to activate your account.",
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "An account with this email already exists. Try signing in instead.",
      });
    }
    return next(error);
  }
}

export async function verifyRegistrationEmail(req, res, next) {
  try {
    const user = await completeRegistrationVerification({
      UserModel: User,
      token: req.body.token,
    });
    if (!user) {
      return res.status(400).json({
        message: "This verification link is invalid, expired, or has already been used. Register again to request a new link.",
      });
    }
    return res.status(200).json({
      message: "Email verified and account activated. You can now sign in.",
    });
  } catch (error) {
    return next(error);
  }
}

export async function login(req, res, next) {
  try {
    if (!isEmailOtpConfigured()) {
      return res.status(503).json({
        message: "Email sign-in codes are temporarily unavailable. Please try again later.",
      });
    }

    const { email, password } = req.body;
    const user = await User.findOne({ email }).select("+passwordHash");
    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash || DUMMY_PASSWORD_HASH
    );

    if (!user || !passwordMatches) {
      return res.status(401).json({
        message: "The email address or password is incorrect.",
      });
    }
    if (!user.emailVerified) {
      return res.status(403).json({
        message: "Verify your email using the link sent to your inbox before signing in.",
      });
    }

    const { code, codeHash } = await createEmailOtp();
    await User.updateOne(
      { _id: user._id, emailVerified: true },
      {
        $set: {
          emailOtpHash: codeHash,
          emailOtpExpiresAt: new Date(Date.now() + EMAIL_OTP_EXPIRY_MS),
          emailOtpPurpose: "login",
        },
      },
    );

    try {
      const delivery = await sendEmailOtp({
        to: user.email,
        code,
        expiresInMinutes: EMAIL_OTP_EXPIRY_MS / (60 * 1000),
      });
      if (!delivery.accepted) {
        return res.status(503).json({
          message: "We could not send your sign-in code. Please try again later.",
        });
      }
    } catch (error) {
      console.warn("Sign-in code delivery failed.", safeEmailProviderFailure(error));
      return res.status(503).json({
        message: "We could not send your sign-in code. Please try again later.",
      });
    }

    return res.status(202).json({
      message: "A 6-digit sign-in code was sent to your email address.",
    });
  } catch (error) {
    return next(error);
  }
}

export async function verifyLoginOtp(req, res, next) {
  try {
    const user = await completeEmailOtp({
      UserModel: User,
      email: req.body.email,
      code: req.body.code,
    });
    if (!user) {
      return res.status(400).json({
        message: "The code is invalid or has expired. Sign in again to request a new code.",
      });
    }

    createSession(res, user._id);
    return res.status(200).json({
      message: "Signed in successfully.",
      user: publicUser(user),
    });
  } catch (error) {
    return next(error);
  }
}

export function currentUser(req, res) {
  return res.status(200).json({ user: publicUser(req.user) });
}

export function logout(_req, res) {
  clearSession(res);
  return res.status(200).json({ message: "Signed out successfully." });
}

export async function requestPasswordReset(req, res, next) {
  try {
    if (isPasswordResetEmailConfigured()) {
      const user = await User.findOne({ email: req.body.email });
      if (user) {
        const { token, tokenHash } = createPasswordResetToken();
        const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
        await User.updateOne(
          { _id: user._id },
          { $set: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt } },
        );
        const resetUrl = `${getPasswordResetAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
        try {
          const delivery = await sendPasswordResetEmail({ to: user.email, resetUrl, expiresInMinutes: 30 });
          if (delivery.accepted) {
            console.info("Password reset email accepted by Resend.");
          } else {
            console.warn("Password reset email was not accepted by Resend.");
          }
        } catch (error) {
          console.warn("Password reset email delivery failed.", safeEmailProviderFailure(error));
        }
      }
    } else {
      console.warn("Password reset email delivery is disabled; missing configuration.", {
        missing: getMissingPasswordResetEmailConfiguration(),
      });
    }
    return res.status(202).json({ message: RESET_REQUEST_MESSAGE });
  } catch (error) {
    return next(error);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const user = await completePasswordReset({ UserModel: User, ...req.body });
    if (!user) {
      return res.status(400).json({ message: "This reset link is invalid or has expired. Request a new one." });
    }
    return res.status(200).json({ message: "Password updated. You can now sign in with your new password." });
  } catch (error) {
    return next(error);
  }
}

export async function updateProfile(req, res, next) {
  try {
    Object.assign(req.user, req.body);
    await req.user.save();

    return res.status(200).json({
      message: "Profile updated successfully.",
      user: publicUser(req.user),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "Another account already uses this email address.",
      });
    }
    return next(error);
  }
}

export async function uploadProfilePhoto(req, res, next) {
  const contentType = validateProfilePhoto(req.file, res);
  if (!contentType) return;

  try {
    const photo = await ProfilePhoto.findOneAndUpdate(
      { userId: req.user._id },
      { $set: { contentType, data: req.file.buffer } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    req.user.profilePhotoUpdatedAt = photo.updatedAt || new Date();
    await req.user.save();
    return res.status(200).json({
      message: "Profile photo saved.",
      user: publicUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
}

export async function getProfilePhoto(req, res, next) {
  try {
    const photo = await ProfilePhoto.findOne({ userId: req.user._id });
    if (!photo?.data) {
      return res.status(404).json({ message: "No profile photo has been uploaded." });
    }

    res.set({
      "Cache-Control": "private, no-store",
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.data.length),
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-site",
    });
    return res.status(200).send(photo.data);
  } catch (error) {
    return next(error);
  }
}

export async function removeProfilePhoto(req, res, next) {
  try {
    await ProfilePhoto.deleteOne({ userId: req.user._id });
    req.user.profilePhotoUpdatedAt = null;
    await req.user.save();
    return res.status(200).json({
      message: "Profile photo removed.",
      user: publicUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
}
