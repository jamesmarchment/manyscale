import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "../config.js";
import { writeJsonAtomic } from "./jsonStore.js";

const NOTIFICATIONS_FILE = path.join(PROJECT_ROOT, "notifications.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(NOTIFICATIONS_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    // Unlike tenants.json, a corrupt notifications file isn't worth refusing to boot
    // over — it's an ops inbox, not tenant data. Start empty; the next write replaces it.
    console.error("Cannot read notifications.json — starting with an empty in-memory list:", err.message);
    return [];
  }
}

let _notifications = load();

function save() {
  writeJsonAtomic(NOTIFICATIONS_FILE, _notifications);
}

// dedupeKey collapses repeated events (e.g. the same SMTP failure firing on every
// request) into one row instead of spamming the inbox: a matching *unread* record has
// its occurrences/message/updatedAt bumped in place. Once a record is marked read, a
// fresh matching event creates a new one, so a recurring problem still resurfaces after
// being dismissed.
export function createNotification({ scope, tenantSlug = null, type, severity = "info", message, dedupeKey = null }) {
  const now = new Date().toISOString();
  if (dedupeKey) {
    const existing = _notifications.find((n) =>
      n.dedupeKey === dedupeKey && n.scope === scope && n.tenantSlug === tenantSlug && !n.readAt
    );
    if (existing) {
      existing.updatedAt = now;
      existing.occurrences += 1;
      existing.message = message;
      save();
      return existing;
    }
  }
  const record = {
    id: "ntf_" + crypto.randomBytes(9).toString("base64url"),
    scope, tenantSlug, type, severity, message, dedupeKey,
    createdAt: now, updatedAt: now, occurrences: 1, readAt: null,
  };
  _notifications.push(record);
  save();
  return record;
}

// scope: "architect" — architect-scoped items only.
// scope: "tenant", tenantSlug — that tenant's items only.
// scope: "architect", includeTenants: true — architect's aggregated view: architect-scoped
// items plus every tenant's items, since architect can already view/impersonate any tenant.
export function listNotifications({ scope, tenantSlug = null, includeTenants = false, unreadOnly = false } = {}) {
  return _notifications
    .filter((n) => (n.scope === scope && n.tenantSlug === tenantSlug) || (includeTenants && n.scope === "tenant"))
    .filter((n) => !unreadOnly || !n.readAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function countUnread(filter) {
  return listNotifications({ ...filter, unreadOnly: true }).length;
}

// Looks up by id AND scope/tenantSlug (or, for an architect marking any tenant's item
// read, scope: "architect" with allowTenantScoped: true) so a tenant admin can't mark
// another tenant's — or architect's — notification read by guessing an id.
export function markRead(id, { scope, tenantSlug = null, allowTenantScoped = false }) {
  const n = _notifications.find((x) => x.id === id);
  if (!n) return false;
  const matches = (n.scope === scope && n.tenantSlug === tenantSlug) || (allowTenantScoped && n.scope === "tenant");
  if (!matches) return false;
  n.readAt = new Date().toISOString();
  save();
  return true;
}

// nodemailer surfaces a connection/auth-level failure (SMTP itself is unreachable or
// misconfigured — affects every tenant) very differently from a per-message rejection
// (e.g. a bad recipient address — affects only that one send). These codes are the
// connection/auth ones; anything else is treated as message-specific.
const SMTP_TRANSPORT_ERROR_CODES = new Set([
  "ECONNECTION", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ESOCKET", "EAUTH", "EDNS", "ECONNRESET",
]);

// Shared by every outbound-email catch block: always records the tenant-scoped failure
// (that tenant's mail isn't arriving), and additionally raises a distinct
// architect-scoped alert when the failure looks structural — architect is the only one
// who can fix .env SMTP settings, and a structural failure affects every tenant at once,
// not just this one send.
export function notifyEmailFailure(err, { tenantSlug, context }) {
  createNotification({
    scope: "tenant", tenantSlug, type: "email_failure", severity: "error",
    message: `${context} failed to send.`,
    dedupeKey: "email_failure:" + tenantSlug,
  });
  if (SMTP_TRANSPORT_ERROR_CODES.has(err?.code)) {
    createNotification({
      scope: "architect", type: "smtp_down", severity: "error",
      message: `SMTP appears to be down or misconfigured (${err.code}: ${err.message}) — every tenant's outbound email is affected.`,
      dedupeKey: "smtp_down",
    });
  }
}

// Shared by admin/architect panel save handlers whose try/catch already flashes an
// error locally to whoever's using the panel — this additionally tells architect, since
// they otherwise have no visibility into a tenant admin's save silently failing (disk
// full, permissions, a locked file on the NAS, etc).
export function notifyWriteFailure(err, { tenantSlug, context }) {
  createNotification({
    scope: "architect", type: "write_failure", severity: "error",
    message: `${context} failed to save: ${err.message}`,
    dedupeKey: "write_failure:" + (tenantSlug || "architect"),
  });
}
