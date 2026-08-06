import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "../lib/auth.js";

// Must be set before the first (dynamic) import of anything that touches config.js —
// static imports are hoisted and would run before this, so config.js is only ever
// reached via the dynamic imports below. Using the architect login (a single global
// role, gated by one env var) instead of a tenant login means these tests never need to
// read or write the real tenants.json / data/{slug}.json files.
process.env.ARCHITECT_ADMIN_PASSWORD_HASH = hashPassword("test-password-123!");
process.env.SESSION_SECRET ||= "test-session-secret-for-node-test-suite-only";

const { default: app } = await import("../lib/app.js");
const { default: supertest } = await import("supertest");

function extractCsrfToken(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match, "expected a _csrf hidden field in the rendered login form");
  return match[1];
}

function extractSessionCookieValue(setCookieHeader) {
  const line = (setCookieHeader || []).find(c => c.startsWith("connect.sid="));
  assert.ok(line, "expected a connect.sid cookie in Set-Cookie");
  return line.split(";")[0];
}

// Order matters: this file shares one module-level login rate limiter (keyed by IP)
// across every test below, since node:test runs a file's tests in one process. The
// rate-limit-exhaustion test is last on purpose, so it doesn't starve the others.

test("CSRF: a login POST without a valid token does not log the user in; the same request with the token from the preceding GET does", async () => {
  const agent = supertest.agent(app);

  const getRes = await agent.get("/architect/login");
  const csrfToken = extractCsrfToken(getRes.text);

  // csrfErrorHandler (lib/csrf.js) redirects HTML form submissions back to the
  // referring page rather than returning a bare 403 (so a real browser lands back on a
  // form with a fresh token instead of a blank error page) — so the meaningful
  // assertion here is "did this request actually authenticate", not the exact status
  // code of the rejection itself, which is a UX choice rather than a security property.
  await agent.post("/architect/login").type("form").send({ password: "test-password-123!" }); // no _csrf
  const stillLoggedOut = await agent.get("/architect");
  assert.equal(stillLoggedOut.status, 302, "a login POST with no CSRF token must not authenticate the session");
  assert.equal(stillLoggedOut.headers.location, "/architect/login");

  const withToken = await agent
    .post("/architect/login")
    .type("form")
    .send({ password: "test-password-123!", _csrf: csrfToken });
  assert.equal(withToken.status, 302);
  assert.equal(withToken.headers.location, "/architect", "the same request with a valid CSRF token must succeed");

  const nowLoggedIn = await agent.get("/architect");
  assert.equal(nowLoggedIn.status, 200, "the session should now be authenticated");
});

test("session regeneration: the session cookie changes after a successful login", async () => {
  const agent = supertest.agent(app);

  const getRes = await agent.get("/architect/login");
  const preLoginSid = extractSessionCookieValue(getRes.headers["set-cookie"]);
  const csrfToken = extractCsrfToken(getRes.text);

  const postRes = await agent
    .post("/architect/login")
    .type("form")
    .send({ password: "test-password-123!", _csrf: csrfToken });
  assert.equal(postRes.status, 302);
  const postLoginSid = extractSessionCookieValue(postRes.headers["set-cookie"]);

  assert.notEqual(postLoginSid, preLoginSid, "login must issue a new session ID (regenerate), not reuse the pre-auth one");
});

test("login rate limiting: enough failed attempts eventually return 429", async () => {
  const agent = supertest.agent(app);

  let getRes = await agent.get("/architect/login");
  let csrfToken = extractCsrfToken(getRes.text);

  let sawRateLimited = false;
  for (let i = 0; i < 15 && !sawRateLimited; i++) {
    const res = await agent
      .post("/architect/login")
      .type("form")
      .send({ password: "definitely-wrong", _csrf: csrfToken });
    if (res.status === 429) {
      sawRateLimited = true;
      break;
    }
    // A failed login re-renders the login page (with a fresh token) directly in the
    // response body — no extra GET needed between attempts.
    csrfToken = extractCsrfToken(res.text);
  }
  assert.ok(sawRateLimited, "expected a 429 after enough failed login attempts");
});
