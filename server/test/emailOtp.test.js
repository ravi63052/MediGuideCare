import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";

import {
  completeEmailOtp,
  createEmailOtp,
} from "../src/services/emailOtpService.js";

function fakeUserModel({ email, codeHash, purpose, expiresAt, emailVerified }) {
  const state = {
    email,
    emailOtpHash: codeHash,
    emailOtpPurpose: purpose,
    emailOtpExpiresAt: expiresAt,
    emailVerified,
  };
  return {
    state,
    findOne(filter) {
      return {
        select: async () => {
          if (
            state.email !== filter.email ||
            state.emailOtpPurpose !== filter.emailOtpPurpose ||
            state.emailOtpExpiresAt <= filter.emailOtpExpiresAt.$gt ||
            state.emailVerified !== filter.emailVerified
          ) {
            return null;
          }
          return { emailOtpHash: state.emailOtpHash };
        },
      };
    },
    async findOneAndUpdate(filter, update) {
      const matches =
        state.email === filter.email &&
        state.emailOtpPurpose === filter.emailOtpPurpose &&
        state.emailOtpHash === filter.emailOtpHash &&
        state.emailOtpExpiresAt > filter.emailOtpExpiresAt.$gt &&
        state.emailVerified === filter.emailVerified;
      if (!matches) return null;
      Object.assign(state, update.$set);
      return state;
    },
  };
}

test("email codes are six digits and are stored only as bcrypt hashes", async () => {
  const first = await createEmailOtp();
  const second = await createEmailOtp();
  assert.match(first.code, /^\d{6}$/);
  assert.match(first.codeHash, /^\$2[aby]\$/);
  assert.notEqual(first.codeHash, first.code);
  assert.equal(await bcrypt.compare(first.code, first.codeHash), true);
  assert.match(second.code, /^\d{6}$/);
});

test("login OTP is single-use and does not change email verification", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const { code, codeHash } = await createEmailOtp();
  const userModel = fakeUserModel({
    email: "patient@example.com",
    codeHash,
    purpose: "login",
    expiresAt: new Date(now.getTime() + 1000),
    emailVerified: true,
  });

  assert.ok(
    await completeEmailOtp({
      UserModel: userModel,
      email: "patient@example.com",
      code,
      now,
    }),
  );
  assert.equal(userModel.state.emailVerified, true);
  assert.equal(
    await completeEmailOtp({
      UserModel: userModel,
      email: "patient@example.com",
      code,
      now,
    }),
    null,
  );
});
