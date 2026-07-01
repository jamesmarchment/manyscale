// server.js
/*

ManyScale Server
v0.0.1
2026-06-14
James Marchment and Samantha Joel

*/

// imports
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";
import multer from "multer";

import { PORT } from "./config.js";
import { resolveTableIDs, runFullRefresh } from "./lib/airtable.js";
import { sessionMiddleware, tenantLocalsMiddleware } from "./middleware.js";
import apiRouter from "./routes/api.js";
import formsRouter from "./routes/forms.js";
import publicRouter from "./routes/public.js";
import adminRouter from "./routes/admin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();


// using EJS
app.set("view engine", "ejs");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(sessionMiddleware);

// static files
app.use(express.static("public"));



// Expose tenant-level locals to all templates
app.use(tenantLocalsMiddleware);
app.use(apiRouter);
app.use(formsRouter);
app.use(publicRouter);
app.use(adminRouter);






// double-check that server started up, save to log
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});



// Resolve table IDs once at startup, then kick off the data refresh cycle.
// If Airtable is unreachable the server still starts and serves from the local disk cache;
// the interval keeps retrying so it auto-recovers when connectivity is restored.
console.log("Starting ManyScale…");
resolveTableIDs().then(ok => {
  if (ok) {
    runFullRefresh("relationships").catch(err => console.error("[startup] Initial refresh failed:", err));
  } else {
    console.warn("[startup] Airtable unavailable — serving from local disk cache if available. Will retry in 6 hours.");
  }
  setInterval(async () => {
    const resolved = await resolveTableIDs();
    if (resolved) {
      await runFullRefresh("relationships").catch(err => console.error("[refresh] Scheduled refresh failed:", err));
    } else {
      console.warn("[refresh] Airtable still unavailable — will retry next cycle.");
    }
  }, 6 * 60 * 60 * 1000);
});
