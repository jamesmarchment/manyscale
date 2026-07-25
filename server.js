// server.js
/*

ManyScale Server
v0.1.0
2026-07-02
James Marchment and Samantha Joel

*/

import express from "express";
import cors from "cors";

import { PORT, MULTI_TENANT, _tenantsList } from "./config.js";
import { resolveTableIDs, runFullRefresh } from "./lib/airtable.js";
import { sessionMiddleware, tenantLocalsMiddleware, resolveTenant } from "./middleware.js";
import apiRouter from "./routes/api.js";
import formsRouter from "./routes/forms.js";
import publicRouter from "./routes/public.js";
import adminRouter from "./routes/admin.js";
import landingRouter from "./routes/landing.js";
import architectRouter from "./routes/architect.js";

const app = express();

app.set("view engine", "ejs");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(express.static("public"));
app.use(architectRouter);

if (MULTI_TENANT) {
  // landingRouter only defines specific paths (/, /search, /search/suggestions,
  // POST /request-repo) — it must be tried before the /:slug catch-all, otherwise
  // resolveTenant treats e.g. "search" as a candidate slug and 404s "Unknown tenant"
  // before landingRouter ever sees the request. Anything not matching those exact
  // paths falls through via next() to the /:slug chain below, unchanged.
  app.use("/", landingRouter);
  app.use("/:slug", resolveTenant, tenantLocalsMiddleware, apiRouter, formsRouter, publicRouter, adminRouter);
} else {
  app.use(resolveTenant);
  app.use(tenantLocalsMiddleware);
  app.use(apiRouter);
  app.use(formsRouter);
  app.use(publicRouter);
  app.use(adminRouter);
}

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
