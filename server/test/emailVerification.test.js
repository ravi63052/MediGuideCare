import assert from "node:assert/strict";
import test from "node:test";

import {
  completeEmailVerification,
  createEmailVerificationToken,
  hashEmailVerificationToken,
} from "../src/services/emailVerificationService.js";

function fakeUserModel({ tokenHash, expiresAt }) {
  const state = {
    emailVerified: false,
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpiresAt: expiresAt,
  };
  return {
    state,
    async findOneAndUpdate(filter, update) {
      const tokenMatches = state.emailVerificationTokenHash === filter.emailVerificationTokenHash;
      const expiryMatches = state.emailVerificationExpiresAt > filter.emailVerificationExpiresAt.$gt;
      if (state.emailVerified || !tokenMatches || !expiryMatches) return null;
      Object.assign(state, update.$set);
      return state;
    },
  };
}

test("verification tokens are random, URL-safe and stored as a one-way hash", () => {
  const first = createEmailVerificationToken();
  const second = createEmailVerificationToken();
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashEmailVerificationToken(first.token));
  assert.notEqual(first.tokenHash, first.token);
});

test("invalid, expired, and previously used tokens cannot verify an email", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const token = createEmailVerificationToken();
  const invalid = fakeUserModel({
    tokenHash: "another-hash",
    expiresAt: new Date(now.getTime() + 1000),
  });
  assert.equal(
    await completeEmailVerification({ UserModel: invalid, token: token.token, now }),
    null,
  );

  const expired = fakeUserModel({
    tokenHash: token.tokenHash,
    expiresAt: new Date(now.getTime() - 1),
  });
  assert.equal(
    await completeEmailVerification({ UserModel: expired, token: token.token, now }),
    null,
  );

  const reusable = fakeUserModel({
    tokenHash: token.tokenHash,
    expiresAt: new Date(now.getTime() + 1000),
  });
  const firstUse = await completeEmailVerification({
    UserModel: reusable,
    token: token.token,
    now,
  });
  assert.ok(firstUse);
  assert.equal(reusable.state.emailVerified, true);
  assert.equal(reusable.state.emailVerificationTokenHash, null);
  assert.equal(
    await completeEmailVerification({ UserModel: reusable, token: token.token, now }),
    null,
  );
});
