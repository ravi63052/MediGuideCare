import assert from "node:assert/strict";
import test from "node:test";

import { parseTrustProxy } from "../src/utils/trustProxy.js";

test("trust proxy defaults to one hop and safely bounds true to one hop", () => {
  assert.equal(parseTrustProxy(undefined), 1);
  assert.equal(parseTrustProxy(""), 1);
  assert.equal(parseTrustProxy("true"), 1);
});

test("trust proxy preserves explicit false, hop counts, and proxy lists", () => {
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("2"), 2);
  assert.equal(parseTrustProxy("loopback,linklocal,uniquelocal"), "loopback,linklocal,uniquelocal");
});
