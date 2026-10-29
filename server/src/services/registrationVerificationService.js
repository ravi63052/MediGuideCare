import { createHash, randomBytes } from "node:crypto";

export const REGISTRATION_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function createRegistrationVerificationToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashRegistrationVerificationToken(token),
  };
}

export function hashRegistrationVerificationToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function completeRegistrationVerification({
  UserModel,
  token,
  now = new Date(),
}) {
  return UserModel.findOneAndUpdate(
    {
      emailVerificationTokenHash: hashRegistrationVerificationToken(token),
      emailVerificationTokenExpiresAt: { $gt: now },
      emailVerified: false,
    },
    {
      $set: {
        emailVerified: true,
        emailVerificationTokenHash: null,
        emailVerificationTokenExpiresAt: null,
        emailOtpHash: null,
        emailOtpExpiresAt: null,
        emailOtpPurpose: null,
      },
    },
    { new: true, runValidators: true },
  );
}
