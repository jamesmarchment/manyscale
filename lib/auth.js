import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

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
