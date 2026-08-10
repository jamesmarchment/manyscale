import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Anchor point for cache/, data/, and public/ paths — always the project root,
// regardless of the working directory the process was launched from.
export const PROJECT_ROOT = __dirname;

dotenv.config();

export const PORT = process.env.PORT || 3007;
export const MULTI_TENANT = process.env.MULTI_TENANT === "true";
// Canonical origin for links/images in outbound email (onboarding, password reset/changed).
// Deliberately NOT derived from the request's Host header there — an unvalidated Host
// header is attacker-influenceable and would let a forged request put an attacker's
// domain into a password-reset email. Empty until set in Architect Admin's Platform
// Settings, in which case call sites fall back to req.protocol+req.get("host") same as
// before (existing behavior, not a regression — just no longer the only option).
export const SITE_URL = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
// No insecure fallback here on purpose: a hardcoded default would let anyone who's
// read this source forge a session cookie for any tenant. Fail loudly instead, same as
// the tenants.json read failure below.
if (!process.env.SESSION_SECRET) {
  console.error("[config] SESSION_SECRET is not set in .env — refusing to start. Generate one (e.g. `openssl rand -hex 32`) and set it in .env.");
  process.exit(1);
}
export const SESSION_SECRET = process.env.SESSION_SECRET;
export const ARCHITECT_ADMIN_PASSWORD_HASH = process.env.ARCHITECT_ADMIN_PASSWORD_HASH || "";

export const TENANTS_FILE = path.join(__dirname, "tenants.json");

let _tenantsList;
try {
  _tenantsList = JSON.parse(fs.readFileSync(TENANTS_FILE, "utf8"));
} catch (err) {
  console.error("Cannot read tenants.json:", err.message);
  process.exit(1);
}

export { _tenantsList };
// The primary tenant is whichever entry has "primaryTenant": true in tenants.json;
// if none is flagged, the first entry in the list is used.
export const primaryTenant = _tenantsList.find(t => t.primaryTenant === true) || _tenantsList[0];

if (!process.env[primaryTenant.patEnvVar]) {
  console.warn(`[config] ${primaryTenant.patEnvVar} not set in .env — Airtable sync disabled. Server will serve from local disk cache if available.`);
}
if (!primaryTenant.baseId) {
  console.warn("[config] baseId missing from tenants.json — Airtable sync disabled. Server will serve from local disk cache if available.");
}

export function updateEnvVar(key, value) {
  const envPath = path.join(__dirname, ".env");
  const safeValue = String(value).replace(/[\r\n]/g, "");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let content = "";
  try { content = fs.readFileSync(envPath, "utf8"); } catch {}
  const regex = new RegExp(`^${escapedKey}=.*$`, "m");
  content = regex.test(content)
    ? content.replace(regex, `${key}=${safeValue}`)
    : content.trimEnd() + `\n${key}=${safeValue}\n`;
  fs.writeFileSync(envPath, content, "utf8");
}
