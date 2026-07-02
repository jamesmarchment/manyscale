// server.js
/*

ManyScale Server
v0.1.0
2026-07-02
James Marchment and Samantha Joel

*/

import express from "express";
import cors from "cors";

import { PORT, MULTI_TENANT, primaryTenant } from "./config.js";
import { resolveTableIDs, runFullRefresh } from "./lib/airtable.js";
import { sessionMiddleware, tenantLocalsMiddleware, resolveTenant } from "./middleware.js";
import apiRouter from "./routes/api.js";
import formsRouter from "./routes/forms.js";
import publicRouter from "./routes/public.js";
import adminRouter from "./routes/admin.js";
import landingRouter from "./routes/landing.js";
import masterRouter from "./routes/master.js";

const app = express();

app.set("view engine", "ejs");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(express.static("public"));
app.use(tenantLocalsMiddleware);
app.use(masterRouter);

if (MULTI_TENANT) {
  app.use("/:slug", resolveTenant, apiRouter, formsRouter, publicRouter, adminRouter);
  app.use("/", landingRouter);
} else {
  app.use(resolveTenant);
  app.use(apiRouter);
  app.use(formsRouter);
  app.use(publicRouter);
  app.use(adminRouter);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

// Resolve table IDs once at startup, then kick off the data refresh cycle.
// If Airtable is unreachable the server still starts and serves from the local disk cache;
// the interval keeps retrying so it auto-recovers when connectivity is restored.
console.log("Starting ManyScale…");
resolveTableIDs(primaryTenant).then(ok => {
  if (ok) {
    runFullRefresh(primaryTenant.slug).catch(err => console.error("[startup] Initial refresh failed:", err));
  } else {
    console.warn("[startup] Airtable unavailable — serving from local disk cache if available. Will retry in 6 hours.");
  }
  setInterval(async () => {
    const resolved = await resolveTableIDs(primaryTenant);
    if (resolved) {
      await runFullRefresh(primaryTenant.slug).catch(err => console.error("[refresh] Scheduled refresh failed:", err));
    } else {
      console.warn("[refresh] Airtable still unavailable — will retry next cycle.");
    }
  }, 6 * 60 * 60 * 1000);
});
