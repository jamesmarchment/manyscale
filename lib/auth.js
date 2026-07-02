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
