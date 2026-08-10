import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "crypto";
import { SESSION_SECRET } from "../config.js";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const hash = Buffer.from(hashHex, "hex");
    const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    return timingSafeEqual(derived, hash);
  } catch {
    return false;
  }
}

// For comparing plain bearer/query tokens (e.g. ADMIN_TOKEN) where there's no hash to
// derive — timingSafeEqual itself requires equal-length buffers, so a length mismatch
// is checked (and rejected) before it, same as any typical constant-time-compare helper.
export function safeTokenEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ""));
  const bufB = Buffer.from(String(b ?? ""));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function signResetPayload(slug, expiresAt, adminPasswordHash) {
  return createHmac("sha256", SESSION_SECRET)
    .update(`${slug}.${expiresAt}.${adminPasswordHash || ""}`)
    .digest("hex");
}

// Stateless password-reset tokens — no separate "used tokens" storage needed, because the
// signature covers the tenant's CURRENT adminPasswordHash. The moment that hash changes
// (this reset, a different reset, or a manual change), every previously issued token for
// that tenant stops verifying on its own, which is effectively single-use for free.
export function createPasswordResetToken(tenant) {
  const expiresAt = Date.now() + PASSWORD_RESET_TTL_MS;
  const sig = signResetPayload(tenant.slug, expiresAt, tenant.adminPasswordHash);
  return Buffer.from(`${tenant.slug}.${expiresAt}.${sig}`).toString("base64url");
}

export function verifyPasswordResetToken(token, tenant) {
  if (!tenant) return false;
  try {
    const [slug, expiresAtStr, sig] = Buffer.from(String(token), "base64url").toString("utf8").split(".");
    if (slug !== tenant.slug) return false;
    const expiresAt = Number(expiresAtStr);
    if (!expiresAt || Date.now() > expiresAt) return false;
    const expectedSig = signResetPayload(slug, expiresAt, tenant.adminPasswordHash);
    return safeTokenEqual(sig, expectedSig);
  } catch {
    return false;
  }
}
