// server.js
/*

ManyScale Server
v0.1.2
2026-08-23
James Marchment and Samantha Joel

*/

import { PORT, _tenantsList } from "./config.js";
import { ensureTableIDs, refreshTenant } from "./lib/airtable.js";
import { generateRobotsTxt } from "./lib/sitemap.js";
import { tenantLogPrefix } from "./lib/log.js";
import { createNotification } from "./lib/notifications.js";
import app from "./lib/app.js";

// Secure by default: without this, Express's built-in error handler renders full stack
// traces (including absolute file paths) whenever NODE_ENV isn't "production", and
// nothing in this app otherwise sets it. lib/app.js's own catch-all error handler never
// leaks a stack trace regardless of NODE_ENV, so this is defense-in-depth rather than
// the primary fix — but other libraries (EJS caching, Express internals) also key off
// this, so it's worth getting right. Only fills the gap if nothing set it already —
// config.js's dotenv.config() (evaluated above, via the import) has already loaded any
// NODE_ENV a developer put in their own .env, so set NODE_ENV=development there to opt
// into verbose local error pages.
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

// Deployment-wide, editable from Architect Admin → Platform Settings → Airtable Refresh
// (routes/architect.js's POST /architect/settings/refresh) — read live from .env at
// startup, same pattern as the other Platform Settings (SMTP, Plausible), so a change
// there takes effect on the next restart.
const REFRESH_ON_STARTUP = process.env.AIRTABLE_REFRESH_ON_STARTUP !== "false";
const REFRESH_INTERVAL_MS = (Number(process.env.AIRTABLE_REFRESH_INTERVAL_HOURS) || 6) * 60 * 60 * 1000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

// A single blip (one bad cycle) is normal and already falls back to the local disk
// cache silently — only worth flagging to architect once a tenant has failed several
// scheduled cycles in a row, whether that's persistent Airtable unavailability or table
// schema resolution failing (e.g. a renamed/deleted table) after having worked before.
// Counter, not a notification-per-tenant Map to clean up: reset to 0 on any success.
const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const consecutiveRefreshFailures = new Map(); // slug -> count

function recordRefreshFailure(tenant) {
  const count = (consecutiveRefreshFailures.get(tenant.slug) || 0) + 1;
  consecutiveRefreshFailures.set(tenant.slug, count);
  if (count >= CONSECUTIVE_FAILURE_THRESHOLD) {
    createNotification({
      scope: "architect", type: "airtable_refresh_failing", severity: "error",
      message: `Airtable refresh for "${tenant.name}" (${tenant.slug}) has failed ${count} scheduled cycles in a row — check the base ID/PAT, or whether a table was renamed/deleted.`,
      dedupeKey: "airtable_refresh_failing:" + tenant.slug,
    });
  }
}

// Resolves and refreshes every active tenant in parallel — safe because refreshTenant
// is per-slug locked (lib/airtable.js), so tenants never race on shared files, and each
// tenant's own try/catch means one tenant's Airtable outage or misconfiguration can't
// block the others. If Airtable is unreachable for a given tenant, that tenant just
// keeps serving from its local disk cache until the next cycle.
async function refreshAllTenants() {
  await Promise.allSettled(
    _tenantsList
      .filter((tenant) => tenant.active !== false)
      .map(async (tenant) => {
        const pfx = tenantLogPrefix(tenant.slug);
        try {
          const resolved = await ensureTableIDs(tenant);
          if (resolved) {
            await refreshTenant(tenant.slug);
            consecutiveRefreshFailures.delete(tenant.slug);
          } else {
            console.warn(`${pfx} Airtable unavailable — serving from local disk cache if available. Will retry next cycle.`);
            recordRefreshFailure(tenant);
          }
        } catch (err) {
          console.error(`${pfx} Refresh failed:`, err);
          recordRefreshFailure(tenant);
        }
      })
  );
}

console.log("Starting ManyScale…");
// robots.txt needs no Airtable data (just the tenant list already loaded by config.js),
// so it's generated unconditionally here rather than waiting on a refresh cycle — with
// AIRTABLE_REFRESH_ON_STARTUP=false it would otherwise be stale/missing for up to
// AIRTABLE_REFRESH_INTERVAL_HOURS.
generateRobotsTxt();
if (REFRESH_ON_STARTUP) {
  refreshAllTenants().then(() => {
    setInterval(refreshAllTenants, REFRESH_INTERVAL_MS);
  });
} else {
  console.log(`Startup Airtable refresh skipped (AIRTABLE_REFRESH_ON_STARTUP=false) — first refresh in ${REFRESH_INTERVAL_MS / (60 * 60 * 1000)}h.`);
  setInterval(refreshAllTenants, REFRESH_INTERVAL_MS);
}
