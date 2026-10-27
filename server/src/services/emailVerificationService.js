import { createHash, randomBytes } from "node:crypto";

export const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function createEmailVerificationToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashEmailVerificationToken(token) };
}

export function hashEmailVerificationToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function completeEmailVerification({ UserModel, token, now = new Date() }) {
  return UserModel.findOneAndUpdate(
    {
      emailVerified: false,
      emailVerificationTokenHash: hashEmailVerificationToken(token),
      emailVerificationExpiresAt: { $gt: now },
    },
    {
      $set: {
        emailVerified: true,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    },
    { new: true, runValidators: true },
  );
}
