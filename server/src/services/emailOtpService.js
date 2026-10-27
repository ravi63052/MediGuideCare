import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

export const EMAIL_OTP_EXPIRY_MS = 10 * 60 * 1000;

export async function createEmailOtp() {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return { code, codeHash: await bcrypt.hash(code, 10) };
}

export async function completeEmailOtp({
  UserModel,
  email,
  code,
  purpose,
  now = new Date(),
}) {
  const criteria = {
    email,
    emailOtpPurpose: purpose,
    emailOtpExpiresAt: { $gt: now },
    ...(purpose === "registration" ? { emailVerified: false } : { emailVerified: true }),
  };
  const candidate = await UserModel.findOne(criteria).select("+emailOtpHash");
  if (!candidate?.emailOtpHash || !(await bcrypt.compare(code, candidate.emailOtpHash))) {
    return null;
  }

  const updates = {
    emailOtpHash: null,
    emailOtpExpiresAt: null,
    emailOtpPurpose: null,
  };
  if (purpose === "registration") updates.emailVerified = true;

  return UserModel.findOneAndUpdate(
    {
      ...criteria,
      emailOtpHash: candidate.emailOtpHash,
    },
    { $set: updates },
    { new: true, runValidators: true },
  );
}
