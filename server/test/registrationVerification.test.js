import assert from "node:assert/strict";
import test from "node:test";

import {
  completeRegistrationVerification,
  createRegistrationVerificationToken,
  hashRegistrationVerificationToken,
  REGISTRATION_VERIFICATION_EXPIRY_MS,
} from "../src/services/registrationVerificationService.js";

function fakeUserModel({ tokenHash, expiresAt, emailVerified = false }) {
  const state = {
    emailVerificationTokenHash: tokenHash,
    emailVerificationTokenExpiresAt: expiresAt,
    emailVerified,
    emailOtpHash: "legacy-otp-hash",
    emailOtpExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
    emailOtpPurpose: "registration",
  };

  return {
    state,
    async findOneAndUpdate(filter, update) {
      if (
        state.emailVerificationTokenHash !== filter.emailVerificationTokenHash ||
        state.emailVerificationTokenExpiresAt <= filter.emailVerificationTokenExpiresAt.$gt ||
        state.emailVerified !== filter.emailVerified
      ) {
        return null;
      }
      Object.assign(state, update.$set);
      return state;
    },
  };
}

test("registration verification tokens are random, URL-safe, and stored as hashes", () => {
  const first = createRegistrationVerificationToken();
  const second = createRegistrationVerificationToken();

  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashRegistrationVerificationToken(first.token));
  assert.notEqual(first.tokenHash, first.token);
  assert.equal(REGISTRATION_VERIFICATION_EXPIRY_MS, 24 * 60 * 60 * 1000);
});

test("verification activates an account once and clears legacy registration OTP state", async () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { token, tokenHash } = createRegistrationVerificationToken();
  const UserModel = fakeUserModel({
    tokenHash,
    expiresAt: new Date(now.getTime() + 1000),
  });

  const verified = await completeRegistrationVerification({ UserModel, token, now });
  assert.ok(verified);
  assert.equal(UserModel.state.emailVerified, true);
  assert.equal(UserModel.state.emailVerificationTokenHash, null);
  assert.equal(UserModel.state.emailVerificationTokenExpiresAt, null);
  assert.equal(UserModel.state.emailOtpHash, null);
  assert.equal(UserModel.state.emailOtpPurpose, null);
  assert.equal(await completeRegistrationVerification({ UserModel, token, now }), null);
});

test("verification rejects invalid and expired tokens", async () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const { token, tokenHash } = createRegistrationVerificationToken();
  const UserModel = fakeUserModel({
    tokenHash,
    expiresAt: new Date(now.getTime() - 1),
  });

  assert.equal(await completeRegistrationVerification({ UserModel, token, now }), null);
  assert.equal(
    await completeRegistrationVerification({ UserModel, token: "invalid-token", now }),
    null,
  );
});
