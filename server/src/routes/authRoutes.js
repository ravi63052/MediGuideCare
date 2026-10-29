import express from "express";

import {
  currentUser,
  getProfilePhoto,
  login,
  logout,
  removeProfilePhoto,
  register,
  requestPasswordReset,
  resetPassword,
  uploadProfilePhoto,
  updateProfile,
  verifyLoginOtp,
  verifyRegistrationEmail,
} from "../controllers/authController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { profilePhotoUpload } from "../middleware/profilePhotoUpload.js";
import {
  authRateLimiter,
  emailRequestRateLimiter,
  emailVerificationRateLimiter,
  passwordResetCompletionRateLimiter,
  passwordResetRequestRateLimiter,
} from "../middleware/rateLimiters.js";
import {
  loginSchema,
  profileSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  emailOtpSchema,
  emailVerificationSchema,
  validateBody,
} from "../validators/authValidator.js";

const router = express.Router();

router.post(
  "/register",
  emailRequestRateLimiter,
  authRateLimiter,
  validateBody(registerSchema),
  register,
);
router.post(
  "/verify-registration-email",
  emailVerificationRateLimiter,
  validateBody(emailVerificationSchema),
  verifyRegistrationEmail,
);
router.post("/login", emailRequestRateLimiter, authRateLimiter, validateBody(loginSchema), login);
router.post(
  "/verify-login-otp",
  emailVerificationRateLimiter,
  validateBody(emailOtpSchema),
  verifyLoginOtp,
);
router.post("/forgot-password", passwordResetRequestRateLimiter, validateBody(forgotPasswordSchema), requestPasswordReset);
router.post("/reset-password", passwordResetCompletionRateLimiter, validateBody(resetPasswordSchema), resetPassword);
router.get("/me", requireAuth, currentUser);
router.patch(
  "/profile",
  requireAuth,
  validateBody(profileSchema),
  updateProfile
);
router.post("/profile/photo", requireAuth, profilePhotoUpload, uploadProfilePhoto);
router.get("/profile/photo", requireAuth, getProfilePhoto);
router.delete("/profile/photo", requireAuth, removeProfilePhoto);
router.post("/logout", logout);

export default router;
