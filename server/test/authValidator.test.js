import assert from "node:assert/strict";
import test from "node:test";

import {
  emailVerificationSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema,
} from "../src/validators/authValidator.js";
import User from "../src/models/User.js";

const validRegistration = {
  fullName: "Example Patient",
  email: "patient@example.com",
  password: "CarePlan9!",
};

test("registration and password reset enforce the password strength requirements", () => {
  for (const password of ["Short9!", "careplan9!", "CarePlan!!", "CarePlan99"]) {
    assert.equal(
      registerSchema.safeParse({ ...validRegistration, password }).success,
      false,
      `${password} should not meet the password requirements`,
    );
    assert.equal(
      resetPasswordSchema.safeParse({
        token: "A".repeat(43),
        password,
      }).success,
      false,
      `${password} should not meet the reset password requirements`,
    );
  }

  assert.equal(registerSchema.safeParse(validRegistration).success, true);
  assert.equal(
    resetPasswordSchema.safeParse({
      token: "A".repeat(43),
      password: validRegistration.password,
    }).success,
    true,
  );
});

test("login still accepts existing passwords that do not meet the new creation rules", () => {
  assert.equal(
    loginSchema.safeParse({
      email: "patient@example.com",
      password: "oldpassword",
    }).success,
    true,
  );
});

test("profile updates reject attempts to change account name or email", () => {
  assert.equal(profileSchema.safeParse({ phone: "1234567890" }).success, true);
  assert.equal(profileSchema.safeParse({ fullName: "Changed Name" }).success, false);
  assert.equal(profileSchema.safeParse({ email: "changed@example.com" }).success, false);
  assert.equal(User.schema.path("fullName").options.immutable, true);
  assert.equal(User.schema.path("email").options.immutable, true);
});

test("registration email verification accepts only URL-safe token strings", () => {
  assert.equal(emailVerificationSchema.safeParse({ token: "A".repeat(43) }).success, true);
  assert.equal(emailVerificationSchema.safeParse({ token: "short" }).success, false);
  assert.equal(emailVerificationSchema.safeParse({ token: "A".repeat(43), email: "a@b.com" }).success, false);
});
