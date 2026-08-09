import fs from "fs";
import path from "path";
import { _tenantsList, PROJECT_ROOT } from "../config.js";

// Per-tenant in-memory caches, keyed by slug
export const tenantCaches = new Map();
export const contributorsCache = new Map();
export const lastRefreshTimes = new Map();

// Per-tenant primary table IDs (keyed by slug); populated by resolveTableIDs()
const measuresTableIDs = new Map();
const translationsTableIDs = new Map();
const contributorsTableIDs = new Map();
const submitFormUrls = new Map();

// Per-tenant secondary table IDs (keyed by slug); populated by resolveTableIDs()
const secondaryMeasureTableIDs = new Map();
const secondaryTranslationTableIDs = new Map();

export function getSubmitFormUrl(slug) {
  return submitFormUrls.get(slug) || null;
}

export const CACHE_DIR = path.join(PROJECT_ROOT, "cache");

const LOG_FILE = path.join(PROJECT_ROOT, "server.log");
const LOG_MAX_SIZE = 5 * 1024 * 1024; // 5MB; keeps at most this file + one rotated copy

function rotateLogIfNeeded() {
  try {
    if (fs.statSync(LOG_FILE).size > LOG_MAX_SIZE) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch {
    // ENOENT: no log file yet, nothing to rotate
  }
}

function logDedupEvent(message) {
  rotateLogIfNeeded();
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line, "utf8");
  console.log(message);
}

// Keeps the most recent `keep` timestamped cache backups per tenant, deletes the rest.
function rotateBackups(sliceDir, keep = 5) {
  const files = fs
    .readdirSync(sliceDir)
    .filter((f) => /^cache-.*\.json$/.test(f))
    .sort(); // ISO timestamps in the filename sort chronologically as strings
  for (const stale of files.slice(0, Math.max(0, files.length - keep))) {
    fs.unlinkSync(path.join(sliceDir, stale));
  }
}

// Per-tenant in-flight refresh lock: concurrent triggers for the same tenant piggyback
// on the already-running refresh instead of racing on the same cache/tenants files.
const inFlightRefreshes = new Map();

function withTenantLock(slug, fn) {
  if (inFlightRefreshes.has(slug)) return inFlightRefreshes.get(slug);
  const promise = fn().finally(() => inFlightRefreshes.delete(slug));
  inFlightRefreshes.set(slug, promise);
  return promise;
}

export function getCacheFile(slug) {
  return path.join(CACHE_DIR, slug, "cache.json");
}

export function getPdfDir(slug) {
  return path.join(PROJECT_ROOT, "public", slug, "pdfs");
}

// Fetches all pages from one Airtable table; throws on network or API error.
async function fetchAllPages(pat, baseId, tableId, filterFn = null, pfx = "") {
  const baseUrl = `https://api.airtable.com/v0/${baseId}/${tableId}`;
  const allRecords = [];
  let offset;
  do {
    const url = offset ? `${baseUrl}?offset=${encodeURIComponent(offset)}` : baseUrl;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    if (!response.ok) throw new Error(`Airtable returned ${response.status} for table ${tableId} in base ${baseId}`);
    const page = await response.json();
    if (!page.records || !Array.isArray(page.records)) throw new Error(`No records array from table ${tableId}`);
    const records = filterFn ? page.records.filter(filterFn) : page.records;
    allRecords.push(...records);
    offset = page.offset;
    console.log(`  ${pfx} Fetched ${allRecords.length} records so far…`);
  } while (offset);
  return allRecords;
}

function recordsDiffer(recA, recB) {
  const allKeys = new Set([...Object.keys(recA.fields), ...Object.keys(recB.fields)].filter(k => k !== "translations"));
  for (const k of allKeys) {
    if (JSON.stringify(recA.fields[k]) !== JSON.stringify(recB.fields[k])) return true;
  }
  return false;
}

function describeDiff(fieldsA, fieldsB) {
  const allKeys = new Set([...Object.keys(fieldsA), ...Object.keys(fieldsB)].filter(k => k !== "translations"));
  const diffs = [];
  for (const k of allKeys) {
    if (JSON.stringify(fieldsA[k]) !== JSON.stringify(fieldsB[k])) diffs.push(k);
  }
  return diffs.length ? `fields differ: [${diffs.join(", ")}]` : "records are identical";
}

// Merges secondary records into the primary array, skipping MeasureID duplicates.
// Each dedup event is appended to server.log with a field-level diff summary.
function mergeWithDedup(primaryRecords, secondaryRecords, sourceLabel = "secondary", pfx = "") {
  const byMeasureID = new Map(primaryRecords.map(r => [r.fields["MeasureID"], r]));
  let added = 0, skipped = 0;
  for (const rec of secondaryRecords) {
    const mid = rec.fields["MeasureID"];
    if (mid && byMeasureID.has(mid)) {
      const existing = byMeasureID.get(mid);
      logDedupEvent(
        `${pfx} [DEDUP] MeasureID "${mid}" exists in both primary and ${sourceLabel} — ` +
        describeDiff(existing.fields, rec.fields)
      );
      skipped++;
    } else {
      primaryRecords.push(rec);
      if (mid) byMeasureID.set(mid, rec);
      added++;
    }
  }
  console.log(`${pfx} [merge] ${sourceLabel}: +${added} new, ${skipped} duplicate(s) skipped`);
  return primaryRecords;
}

// Guarantee every cached record has a MeasureID, falling back to the Airtable record id.
function ensureMeasureID(records, pfx = "") {
  records.forEach(r => {
    if (!r.fields["MeasureID"]) {
      console.warn(`${pfx} [ensureMeasureID] Record ${r.id} missing MeasureID — falling back to Airtable id.`);
      r.fields["MeasureID"] = r.id;
    }
  });
  return records;
}

// Returns { count, filenames } — filenames lists every safe filename this call expects
// to exist on disk (freshly downloaded, replaced, or already current), so callers can
// reconcile pdfDir against "what should still be here" without recomputing filenames
// themselves. A filename is only included if the file actually exists afterward — a
// brand-new attachment whose download failed is correctly left untracked, but a
// previously-downloaded file whose re-download attempt failed (e.g. a transient network
// error while checking for a changed attachment) still gets tracked, since the old file
// is still sitting there and still works.
async function downloadAttachmentList(list, localPathKey, pdfDir, urlPrefix, filenameSuffix = "", pfx = "") {
  if (!Array.isArray(list)) return { count: 0, filenames: [] };
  let count = 0;
  const filenames = [];
  const seenFilenames = new Set();
  for (const attachment of list) {
    const origFilename = attachment.filename || "unnamed";
    const ext = path.extname(origFilename) || ".pdf";
    const nameOnly = path.basename(origFilename, ext);
    const safeBaseName = nameOnly
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .replace(/\s+/g, "_");
    const safeSuffix = filenameSuffix
      ? "_" + filenameSuffix.replace(/[^a-zA-Z0-9-]/g, "_")
      : "";
    let safeFilename = `${safeBaseName}${safeSuffix}${ext}`;
    if (seenFilenames.has(safeFilename)) {
      const base = `${safeBaseName}${safeSuffix}`;
      let n = 2;
      let candidate;
      do { candidate = `${base}_${n++}${ext}`; } while (seenFilenames.has(candidate));
      logDedupEvent(`${pfx} [PDF] Duplicate filename "${safeFilename}" in the same attachment list — saving as "${candidate}"`);
      safeFilename = candidate;
    }
    seenFilenames.add(safeFilename);
    const localPath = path.join(pdfDir, safeFilename);

    // Airtable attachments don't expose a per-attachment modified date via the API
    // (only the record's own createdTime, which doesn't change when just an attachment
    // field is edited) — size is the only reliable, already-available signal that the
    // file behind an unchanged filename has actually changed.
    const existed = fs.existsSync(localPath);
    const sizeChanged = existed && typeof attachment.size === "number" && fs.statSync(localPath).size !== attachment.size;

    if (!existed || sizeChanged) {
      console.log(`  ${pfx} ${existed ? "🔄 Replacing changed" : "⬇ Downloading"} ${origFilename} → ${safeFilename}`);
      try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
          console.warn(`  ${pfx} ❌ Failed to download ${origFilename}`);
        } else {
          fs.writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));
          count++;
        }
      } catch (err) {
        console.error(`  ${pfx} ❌ Download error: ${origFilename}`, err);
      }
    }

    if (fs.existsSync(localPath)) {
      attachment[localPathKey] = `${urlPrefix}/${safeFilename}`;
      filenames.push(safeFilename);
    }
  }
  return { count, filenames };
}


// TABLE ID RESOLUTION **********************************************

// Accepts the tenant object so primary and secondary credentials are read from
// tenants.json (via patEnvVar / secondaryPatEnvVar) rather than global env vars.
export async function resolveTableIDs(tenant) {
  const pfx = `[${tenant.slug}]`;
  const pat = process.env[tenant.patEnvVar];
  const baseId = tenant.baseId;

  const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
  console.log(`${pfx} Resolving Airtable table IDs from metadata API…`);

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}` }
    });
  } catch (err) {
    console.error(`${pfx} Metadata API request failed (network error):`, err);
    return false;
  }

  if (response.status === 403) {
    console.error(
      `${pfx} Metadata API returned 403 Forbidden — the PAT is missing the ` +
      "'schema.bases:read' scope. Grant this scope in your Airtable account settings."
    );
    return false;
  }

  if (!response.ok) {
    console.error(`${pfx} Metadata API returned unexpected status ${response.status}.`);
    return false;
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error(`${pfx} Failed to parse metadata API response:`, err);
    return false;
  }

  const tables = data.tables || [];

  const measuresTable = tables.find(t => t.name === "Measures");
  const translationsTable = tables.find(t => t.name === "Translations");

  if (!measuresTable) {
    console.error(
      `${pfx} Table "Measures" not found in base ${baseId}. ` +
      "Cannot load measure data — check the base configuration."
    );
    return false;
  }

  measuresTableIDs.set(tenant.slug, measuresTable.id);
  console.log(`${pfx} Resolved Measures table: ${measuresTable.id}`);

  const formView = (measuresTable.views || []).find(v => v.type === "form");
  if (formView) {
    const submitFormUrl = `https://airtable.com/${baseId}/${formView.id}`;
    submitFormUrls.set(tenant.slug, submitFormUrl);
    console.log(`${pfx} Resolved submit form URL: ${submitFormUrl}`);
  } else {
    submitFormUrls.delete(tenant.slug);
    console.warn(`${pfx} No form view found in Measures table — submit form link will be inactive.`);
  }

  if (!translationsTable) {
    translationsTableIDs.delete(tenant.slug);
    console.warn(
      `${pfx} Table "Translations" not found in base ${baseId}. ` +
      "Continuing without translations."
    );
  } else {
    translationsTableIDs.set(tenant.slug, translationsTable.id);
    console.log(`${pfx} Resolved Translations table: ${translationsTable.id}`);
  }

  const contributorsTable = tables.find(t => t.name === "Contributors");
  if (!contributorsTable) {
    contributorsTableIDs.delete(tenant.slug);
    console.warn(
      `${pfx} Table "Contributors" not found in base ${baseId}. ` +
      "Continuing without contributors data."
    );
  } else {
    contributorsTableIDs.set(tenant.slug, contributorsTable.id);
    console.log(`${pfx} Resolved Contributors table: ${contributorsTable.id}`);
  }

  // Secondary source — configured per-tenant in tenants.json via secondaryPatEnvVar / secondaryBaseId.
  // Failure is a warning, not fatal.
  const secondaryPat = tenant.secondaryPatEnvVar ? process.env[tenant.secondaryPatEnvVar] : null;
  const secondaryBaseId = tenant.secondaryBaseId || null;
  if (secondaryPat && secondaryBaseId) {
    console.log(`${pfx} Resolving secondary Airtable table IDs (base ${secondaryBaseId})…`);
    try {
      const res2 = await fetch(`https://api.airtable.com/v0/meta/bases/${secondaryBaseId}/tables`, {
        headers: { Authorization: `Bearer ${secondaryPat}` }
      });
      if (!res2.ok) {
        console.warn(`${pfx} Secondary metadata API returned ${res2.status} — secondary source disabled.`);
      } else {
        const data2 = await res2.json();
        const tables2 = data2.tables || [];
        const mt2 = tables2.find(t => t.name === "Measures");
        const tt2 = tables2.find(t => t.name === "Translations");
        if (!mt2) {
          console.warn(`${pfx} "Measures" not found in secondary base ${secondaryBaseId} — secondary source disabled.`);
        } else {
          secondaryMeasureTableIDs.set(tenant.slug, mt2.id);
          console.log(`${pfx} Resolved secondary Measures table: ${mt2.id}`);
          if (tt2) {
            secondaryTranslationTableIDs.set(tenant.slug, tt2.id);
            console.log(`${pfx} Resolved secondary Translations table: ${tt2.id}`);
          }
        }
      }
    } catch (err) {
      console.warn(`${pfx} Secondary metadata API request failed — secondary source disabled:`, err.message);
    }
  }

  return true;
}

// Field schemas for the tables scaffoldTenantTables() can create in a fresh base.
// Contributors' "Measures" field is a link to the Measures table and gets its
// linkedTableId filled in at creation time, once the Measures table's id is known.
const SCAFFOLD_TABLE_FIELDS = {
  Measures: [
    { name: "MeasureID", type: "singleLineText" },
    { name: "Measure Name", type: "singleLineText" },
    { name: "Status", type: "singleSelect", options: { choices: [{ name: "Approved" }, { name: "Pending" }, { name: "Rejected" }] } },
    { name: "Construct(s)", type: "multipleSelects", options: { choices: [] } },
    { name: "Number of Items", type: "number", options: { precision: 0 } },
    { name: "Primary Reference", type: "multilineText" },
    { name: "Favorite", type: "checkbox", options: { icon: "check", color: "greenBright" } },
    { name: "Attachments", type: "multipleAttachments" },
    { name: "Full Measure (Required)", type: "multipleAttachments" },
    { name: "Final PDF", type: "multipleAttachments" },
  ],
  Translations: [
    { name: "MeasureID (from MeasureID)", type: "singleLineText" },
    { name: "Language", type: "singleLineText" },
  ],
  Contributors: [
    { name: "Name", type: "singleLineText" },
    { name: "Role", type: "singleSelect", options: { choices: [{ name: "Core Team" }, { name: "Contributor" }, { name: "Funding" }] } },
    { name: "Contribution(s)", type: "multipleSelects", options: { choices: [] } },
    // "Measures" (multipleRecordLinks) is appended once the Measures table id is known.
  ],
};

// Creates any of the Measures/Translations/Contributors tables missing from a fresh
// Airtable base, so a new tenant doesn't have to build the schema by hand. Measures is
// created first so Contributors' "Measures" link field can reference its table id.
// Never throws — partial failures are reported in the returned summary instead.
export async function scaffoldTenantTables(pat, baseId) {
  const summary = { created: [], skipped: [], errors: [] };
  const metaUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;

  let existingTables;
  try {
    const response = await fetch(metaUrl, { headers: { Authorization: `Bearer ${pat}` } });
    if (!response.ok) {
      summary.errors.push({ table: null, message: `Could not read existing tables (status ${response.status}).` });
      return summary;
    }
    const data = await response.json();
    existingTables = data.tables || [];
  } catch (err) {
    summary.errors.push({ table: null, message: `Could not read existing tables: ${err.message}` });
    return summary;
  }

  let measuresTableId = (existingTables.find(t => t.name === "Measures") || {}).id || null;

  for (const tableName of ["Measures", "Translations", "Contributors"]) {
    if (existingTables.some(t => t.name === tableName)) {
      summary.skipped.push(tableName);
      continue;
    }

    const fields = SCAFFOLD_TABLE_FIELDS[tableName].slice();
    if (tableName === "Contributors" && measuresTableId) {
      fields.push({ name: "Measures", type: "multipleRecordLinks", options: { linkedTableId: measuresTableId } });
    }

    try {
      const createResponse = await fetch(metaUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: tableName, fields }),
      });
      if (!createResponse.ok) {
        const errBody = await createResponse.text().catch(() => "");
        summary.errors.push({ table: tableName, message: `Create failed (status ${createResponse.status}): ${errBody}` });
        continue;
      }
      const created = await createResponse.json();
      if (tableName === "Measures") measuresTableId = created.id;
      summary.created.push(tableName);
    } catch (err) {
      summary.errors.push({ table: tableName, message: err.message });
    }
  }

  return summary;
}


// CACHE TO DISK **********************************************

// Ensure root cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Load existing on-disk cache for every active tenant at startup, so each one has
// something to serve immediately if Airtable happens to be unreachable when this
// tenant's own refresh runs.
for (const tenant of _tenantsList) {
  if (tenant.active === false) continue;
  const slug = tenant.slug;
  const pfx = `[${slug}]`;
  const sliceDir = path.join(CACHE_DIR, slug);
  if (!fs.existsSync(sliceDir)) fs.mkdirSync(sliceDir, { recursive: true });
  const cacheFile = getCacheFile(slug);
  if (fs.existsSync(cacheFile)) {
    const raw = fs.readFileSync(cacheFile);
    tenantCaches.set(slug, ensureMeasureID(JSON.parse(raw).records, pfx));
  }
}

// Fetches measures and translations from all configured sources and rebuilds the unified cache.
export async function refreshCache(slug) {
  const pfx = `[${slug}]`;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) {
    console.error(`${pfx} No tenant found for slug "${slug}"`);
    return;
  }
  const pat = process.env[tenant.patEnvVar];
  const baseId = tenant.baseId;
  const secondaryPat = tenant.secondaryPatEnvVar ? process.env[tenant.secondaryPatEnvVar] : null;
  const secondaryBaseId = tenant.secondaryBaseId || null;
  const secondaryMeasureTableID = secondaryMeasureTableIDs.get(slug) || null;
  const secondaryTranslationTableID = secondaryTranslationTableIDs.get(slug) || null;
  const measuresTableID = measuresTableIDs.get(slug) || null;
  const translationsTableID = translationsTableIDs.get(slug) || null;

  if (!measuresTableID) {
    console.error(`${pfx} No Measures table ID resolved for this tenant — call resolveTableIDs() first. Skipping refresh.`);
    return;
  }

  const cacheFile = getCacheFile(slug);
  const sliceDir = path.join(CACHE_DIR, slug);
  if (!fs.existsSync(sliceDir)) fs.mkdirSync(sliceDir, { recursive: true });

  let existingCacheContent = "";
  if (fs.existsSync(cacheFile)) {
    try {
      existingCacheContent = fs.readFileSync(cacheFile, "utf8");
    } catch (err) {
      console.error(`${pfx} Failed to read old cache:`, err);
    }
  }

  // Primary measures
  console.log(`${pfx} Fetching Airtable data (primary: base ${baseId}, table ${measuresTableID})…`);
  let allRecords;
  try {
    allRecords = await fetchAllPages(pat, baseId, measuresTableID, r => r.fields["Status"] === "Approved", pfx);
    allRecords.forEach(r => { delete r.fields["Full Measure (Required)"]; });
    console.log(`${pfx} Primary: ${allRecords.length} approved records`);
  } catch (err) {
    console.error(`${pfx} Error fetching primary Airtable data:`, err);
    return;
  }

  // Secondary measures — only used if this tenant has a secondary source configured
  if (secondaryMeasureTableID && secondaryPat && secondaryBaseId) {
    console.log(`${pfx} Fetching Airtable data (secondary: base ${secondaryBaseId}, table ${secondaryMeasureTableID})…`);
    try {
      const secondary = await fetchAllPages(secondaryPat, secondaryBaseId, secondaryMeasureTableID, r => r.fields["Status"] === "Approved", pfx);
      secondary.forEach(r => { delete r.fields["Full Measure (Required)"]; });
      console.log(`${pfx} Secondary: ${secondary.length} approved records (before dedup)`);
      allRecords = mergeWithDedup(allRecords, secondary, "secondary", pfx);
    } catch (err) {
      console.error(`${pfx} Error fetching secondary Airtable data — continuing with primary only:`, err);
    }
  }

  // Update in-memory cache
  tenantCaches.set(slug, ensureMeasureID(allRecords, pfx));

  // Translations from all sources, matched against the combined measure cache
  const allTranslations = [];

  if (translationsTableID) {
    console.log(`${pfx} Fetching translation table (primary: table ${translationsTableID})…`);
    try {
      const trs = await fetchAllPages(pat, baseId, translationsTableID, null, pfx);
      allTranslations.push(...trs);
      console.log(`${pfx} Primary translations: ${trs.length}`);
    } catch (err) {
      console.error(`${pfx} Error fetching primary translations — skipping:`, err);
    }
  }

  if (secondaryTranslationTableID && secondaryPat && secondaryBaseId) {
    console.log(`${pfx} Fetching translation table (secondary: table ${secondaryTranslationTableID})…`);
    try {
      const trs2 = await fetchAllPages(secondaryPat, secondaryBaseId, secondaryTranslationTableID, null, pfx);
      allTranslations.push(...trs2);
      console.log(`${pfx} Secondary translations: ${trs2.length}`);
    } catch (err) {
      console.error(`${pfx} Error fetching secondary translations — skipping:`, err);
    }
  }

  let matched = 0;
  for (const tr of allTranslations) {
    const linkedIDs = [].concat(tr.fields["MeasureID (from MeasureID)"] || []);
    for (const measureID of linkedIDs) {
      const primary = allRecords.find(r => r.id === measureID || r.fields["MeasureID"] === measureID);
      if (primary) {
        if (!primary.fields.translations) primary.fields.translations = [];
        primary.fields.translations.push(tr.fields);
        matched++;
      } else {
        console.warn(`${pfx} [translations] No primary record found for MeasureID "${measureID}"`);
      }
    }
  }
  if (allTranslations.length > 0) {
    console.log(`${pfx} Merged ${matched} of ${allTranslations.length} translation records into cache.`);
  }

  const jsonString = JSON.stringify({ records: allRecords }, null, 2);
  fs.writeFileSync(cacheFile, jsonString);
  console.log(`${pfx} Updated main cache: ${cacheFile} (${allRecords.length} records total)`);

  if (jsonString !== existingCacheContent) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(sliceDir, `cache-${timestamp}.json`);
    fs.writeFileSync(backupFile, jsonString);
    console.log(`${pfx} Created backup: ${backupFile}`);
    rotateBackups(sliceDir);
  } else {
    console.log(`${pfx} No changes detected — backup skipped.`);
  }
}

export async function refreshContributors(slug) {
  const pfx = `[${slug}]`;
  const contributorsTableID = contributorsTableIDs.get(slug) || null;
  if (!contributorsTableID) return;
  const tenant = _tenantsList.find(t => t.slug === slug);
  if (!tenant) return;
  const pat = process.env[tenant.patEnvVar];
  const baseId = tenant.baseId;

  console.log(`${pfx} Fetching Contributors table (table ${contributorsTableID})…`);
  const baseUrl = `https://api.airtable.com/v0/${baseId}/${contributorsTableID}`;
  const allRecords = [];
  try {
    let offset;
    do {
      const url = offset ? `${baseUrl}?offset=${encodeURIComponent(offset)}` : baseUrl;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${pat}` }
      });
      if (!response.ok) {
        console.error(`${pfx} Contributors table returned status ${response.status}. Skipping.`);
        return;
      }
      const page = await response.json();
      if (!page.records || !Array.isArray(page.records)) {
        console.error(`${pfx} Contributors response missing records. Skipping.`);
        return;
      }
      allRecords.push(...page.records);
      offset = page.offset;
    } while (offset);
  } catch (err) {
    console.error(`${pfx} Error fetching contributors:`, err);
    return;
  }
  contributorsCache.set(slug, allRecords);
  console.log(`${pfx} Loaded ${allRecords.length} contributor records.`);
}

// Save public stats for the cache-stats.json endpoint
export function refreshCounts(slug) {
  const cache = tenantCaches.get(slug) || [];
  let totalMeasures = 0;
  let totalConstructs = 0;
  let totalItems = 0;
  let totalTranslations = 0;
  let lastUpdated = new Date();

  const constructCounts = {};
  cache.forEach(record => {
    const fields = record.fields;

    totalMeasures++;

    const constructs = fields["Construct(s)"];
    if (Array.isArray(constructs)) {
      constructs.forEach(c => {
        constructCounts[c] = (constructCounts[c] || 0) + 1;
      });
    }

    const numItems = fields["Number of Items"];
    if (typeof numItems === "number") {
      totalItems += numItems;
    }

    totalTranslations += (fields.translations || []).length;
  });

  totalConstructs = Object.keys(constructCounts).length;
  const statsJSON = JSON.stringify({
    slug,
    lastUpdated,
    totalMeasures,
    totalConstructs,
    totalItems,
    totalTranslations,
    constructs: constructCounts,
  }, null, 2);

  const statsDir = path.join(PROJECT_ROOT, "public", slug);
  if (!fs.existsSync(statsDir)) fs.mkdirSync(statsDir, { recursive: true });
  fs.writeFileSync(path.join(statsDir, "cache-stats.json"), statsJSON, "utf8");
}

export async function syncLocalPDFs(slug) {
  const pfx = `[${slug}]`;
  const cacheFile = getCacheFile(slug);
  const pdfDir = getPdfDir(slug);
  const urlPrefix = `/${slug}/pdfs`;
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
  console.log(`${pfx} Checking cache for PDFs to sync…`);

  if (!fs.existsSync(cacheFile)) {
    console.log(`${pfx} No cache file yet — skipping PDF sync.`);
    return;
  }

  const raw = fs.readFileSync(cacheFile, "utf8");
  let json = JSON.parse(raw);

  const records = json.records || [];
  let downloads = 0;
  const expectedFilenames = new Set();

  const track = (result) => {
    downloads += result.count;
    result.filenames.forEach(f => expectedFilenames.add(f));
  };

  for (const record of records) {
    // "Missing PDF" is authoritative: an editor setting it means this measure's PDF
    // shouldn't be offered for download at all, even if Final PDF still has (stale or
    // otherwise) attachment data — so it's not worth keeping in sync, and a previously
    // downloaded copy becomes eligible for the orphan sweep below.
    if (!record.fields["Missing PDF"]) {
      track(await downloadAttachmentList(record.fields["Final PDF"], "f_localPath", pdfDir, urlPrefix, "", pfx));
    }
    track(await downloadAttachmentList(record.fields["json file"], "j_localPath", pdfDir, urlPrefix, "", pfx));
    for (const tr of (record.fields.translations || [])) {
      const lang = tr["Language"] || "";
      track(await downloadAttachmentList(tr["Final PDF"], "f_localPath", pdfDir, urlPrefix, lang, pfx));
    }
  }

  fs.writeFileSync(cacheFile, JSON.stringify(json, null, 2), "utf8");
  if (downloads > 0) {
    console.log(`${pfx} PDF sync complete (${downloads} new/replaced files).`);
  } else {
    console.log(`${pfx} No new PDFs needed.`);
  }

  moveOrphanedPdfs(slug, pdfDir, expectedFilenames, pfx);

  tenantCaches.set(slug, ensureMeasureID(json.records, pfx));
}

// Moves any file in pdfDir that no longer corresponds to a current Airtable attachment
// into a per-tenant recycle bin (cache/{slug}/pdf-trash/) rather than deleting it — a
// mistake in `expectedFilenames` (or a transient Airtable hiccup) is then recoverable by
// hand instead of being an unrecoverable delete. Not auto-purged: unlike the cache-backup/
// log rotation elsewhere in this file, the point here is manual recoverability, so a
// silent purge later would undercut that.
function moveOrphanedPdfs(slug, pdfDir, expectedFilenames, pfx) {
  let files;
  try {
    files = fs.readdirSync(pdfDir);
  } catch {
    return; // pdfDir doesn't exist yet — nothing to reconcile
  }
  const orphans = files.filter(f => !expectedFilenames.has(f));
  if (orphans.length === 0) return;

  const trashDir = path.join(CACHE_DIR, slug, "pdf-trash");
  fs.mkdirSync(trashDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const orphan of orphans) {
    const dest = path.join(trashDir, `${timestamp}_${orphan}`);
    fs.renameSync(path.join(pdfDir, orphan), dest);
    console.log(`  ${pfx} 🗑 Moved orphaned PDF to recycle bin: ${orphan}`);
  }
}

export async function runFullRefresh(slug) {
  const pfx = `[${slug}]`;
  try {
    console.log(`${pfx} Starting full refresh…`);
    await refreshCache(slug);
    await refreshContributors(slug);
    console.log(`${pfx} Syncing PDFs…`);
    await syncLocalPDFs(slug);
    console.log(`${pfx} Counting records…`);
    await refreshCounts(slug);
    lastRefreshTimes.set(slug, new Date());
    console.log(`${pfx} Full refresh complete.`);
  } catch (err) {
    console.error(`${pfx} Error during refresh:`, err);
  }
}

// Locked entry points: use these instead of calling runFullRefresh/refreshCache/
// syncLocalPDFs directly, so overlapping triggers for the same tenant can't race on
// the same cache/tenants files (see audit.md #10).
export function refreshTenant(slug) {
  return withTenantLock(slug, () => runFullRefresh(slug));
}
export function refreshTenantCacheOnly(slug) {
  return withTenantLock(slug, () => refreshCache(slug));
}
export function syncTenantPDFs(slug) {
  return withTenantLock(slug, () => syncLocalPDFs(slug));
}
