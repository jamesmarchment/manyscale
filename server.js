// server.js
/*

ManyScale Server
v0.1.2
2026-08-02
James Marchment and Samantha Joel

*/

import { PORT, _tenantsList } from "./config.js";
import { resolveTableIDs, runFullRefresh } from "./lib/airtable.js";
import app from "./lib/app.js";

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

// Resolves and refreshes every active tenant, one at a time so one tenant's Airtable
// outage or misconfiguration can't block the others. If Airtable is unreachable for a
// given tenant, that tenant just keeps serving from its local disk cache until the next cycle.
async function refreshAllTenants() {
  for (const tenant of _tenantsList) {
    if (tenant.active === false) continue;
    const pfx = `[${tenant.slug}]`;
    try {
      const resolved = await resolveTableIDs(tenant);
      if (resolved) {
        await runFullRefresh(tenant.slug);
      } else {
        console.warn(`${pfx} Airtable unavailable — serving from local disk cache if available. Will retry next cycle.`);
      }
    } catch (err) {
      console.error(`${pfx} Refresh failed:`, err);
    }
  }
}

console.log("Starting ManyScale…");
refreshAllTenants().then(() => {
  setInterval(refreshAllTenants, 6 * 60 * 60 * 1000);
});
