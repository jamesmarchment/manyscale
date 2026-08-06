import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../middleware.js";

test("createRateLimiter allows up to max calls, rejects the next one", () => {
  const limiter = createRateLimiter(3, 60_000);
  assert.equal(limiter("a"), true);
  assert.equal(limiter("a"), true);
  assert.equal(limiter("a"), true);
  assert.equal(limiter("a"), false, "4th call within the window must be rejected");
});

test("createRateLimiter tracks each key independently", () => {
  const limiter = createRateLimiter(1, 60_000);
  assert.equal(limiter("a"), true);
  assert.equal(limiter("a"), false);
  assert.equal(limiter("b"), true, "a different key must not be affected by a's limit");
});

test("createRateLimiter resets once the window has elapsed", async () => {
  const limiter = createRateLimiter(1, 30);
  assert.equal(limiter("a"), true);
  assert.equal(limiter("a"), false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(limiter("a"), true, "a call after the window elapses should be allowed again");
});
