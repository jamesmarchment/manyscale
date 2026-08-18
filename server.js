// server.js
/*

ManyScale Server
v0.1.2
2026-08-02
James Marchment and Samantha Joel

*/

import { PORT, _tenantsList } from "./config.js";
import { resolveTableIDs, refreshTenant } from "./lib/airtable.js";
import { generateRobotsTxt } from "./lib/sitemap.js";
import app from "./lib/app.js";

// Deployment-wide, editable from Architect Admin → Platform Settings → Airtable Refresh
// (routes/architect.js's POST /architect/settings/refresh) — read live from .env at
// startup, same pattern as the other Platform Settings (SMTP, Plausible), so a change
// there takes effect on the next restart.
const REFRESH_ON_STARTUP = process.env.AIRTABLE_REFRESH_ON_STARTUP !== "false";
const REFRESH_INTERVAL_MS = (Number(process.env.AIRTABLE_REFRESH_INTERVAL_HOURS) || 6) * 60 * 60 * 1000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

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
        const pfx = `[${tenant.slug}]`;
        try {
          const resolved = await resolveTableIDs(tenant);
          if (resolved) {
            await refreshTenant(tenant.slug);
          } else {
            console.warn(`${pfx} Airtable unavailable — serving from local disk cache if available. Will retry next cycle.`);
          }
        } catch (err) {
          console.error(`${pfx} Refresh failed:`, err);
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
