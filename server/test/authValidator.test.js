import assert from "node:assert/strict";
import test from "node:test";

import { loginSchema, registerSchema, resetPasswordSchema } from "../src/validators/authValidator.js";

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
