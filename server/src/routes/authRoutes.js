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
  verifyEmail,
} from "../controllers/authController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { profilePhotoUpload } from "../middleware/profilePhotoUpload.js";
import {
  authRateLimiter,
  emailVerificationRequestRateLimiter,
  passwordResetCompletionRateLimiter,
  passwordResetRequestRateLimiter,
} from "../middleware/rateLimiters.js";
import {
  loginSchema,
  profileSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  validateBody,
} from "../validators/authValidator.js";

const router = express.Router();

router.post(
  "/register",
  emailVerificationRequestRateLimiter,
  authRateLimiter,
  validateBody(registerSchema),
  register,
);
router.post("/verify-email", validateBody(verifyEmailSchema), verifyEmail);
router.post("/login", authRateLimiter, validateBody(loginSchema), login);
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
