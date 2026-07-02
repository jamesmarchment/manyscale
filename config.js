import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

export const PORT = process.env.PORT || 3007;
export const MULTI_TENANT = process.env.MULTI_TENANT === "true";
export const SESSION_SECRET = process.env.SESSION_SECRET || "manyscale-dev-secret";
export const MASTER_ADMIN_PASSWORD_HASH = process.env.MASTER_ADMIN_PASSWORD_HASH || "";

export const TENANTS_FILE = path.join(__dirname, "tenants.json");

let _tenantsList;
try {
  _tenantsList = JSON.parse(fs.readFileSync(TENANTS_FILE, "utf8"));
} catch (err) {
  console.error("Cannot read tenants.json:", err.message);
  process.exit(1);
}

export { _tenantsList };
export const primaryTenant = _tenantsList.find(t => t.slug === "relationships") || _tenantsList[0];

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
