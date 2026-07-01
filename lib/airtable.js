import fs from "fs";
import path from "path";
import { AIRTABLE_PAT, BASE_ID, AIRTABLE_PAT_2, BASE_ID_2 } from "../config.js";

// Per-tenant in-memory caches, keyed by slug
export const tenantCaches = new Map();
export let contributorsCache = [];
export const lastRefreshTimes = new Map();

// Resolved once at startup via the metadata API — never read from .env
let MEASURES_TABLE_ID = null;
let TRANSLATIONS_TABLE_ID = null;
let CONTRIBUTORS_TABLE_ID = null;
let MEASURES_TABLE_ID_2 = null;
let TRANSLATIONS_TABLE_ID_2 = null;

export let SUBMIT_FORM_URL = null;

export const CACHE_DIR = "./cache";

const LOG_FILE = path.join(process.cwd(), "server.log");

function logDedupEvent(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line, "utf8");
  console.log(message);
}

export function getCacheFile(slug) {
  return path.join(CACHE_DIR, slug, "cache.json");
}

export function getPdfDir(slug) {
  return path.join(process.cwd(), "public", slug, "pdfs");
}

// Fetches all pages from one Airtable table; throws on network or API error.
async function fetchAllPages(pat, baseId, tableId, filterFn = null) {
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
    console.log(`  Fetched ${allRecords.length} records so far…`);
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
function mergeWithDedup(primaryRecords, secondaryRecords, sourceLabel = "secondary") {
  const byMeasureID = new Map(primaryRecords.map(r => [r.fields["MeasureID"], r]));
  let added = 0, skipped = 0;
  for (const rec of secondaryRecords) {
    const mid = rec.fields["MeasureID"];
    if (mid && byMeasureID.has(mid)) {
      const existing = byMeasureID.get(mid);
      logDedupEvent(
        `[DEDUP] MeasureID "${mid}" exists in both primary and ${sourceLabel} — ` +
        describeDiff(existing.fields, rec.fields)
      );
      skipped++;
    } else {
      primaryRecords.push(rec);
      if (mid) byMeasureID.set(mid, rec);
      added++;
    }
  }
  console.log(`[merge] ${sourceLabel}: +${added} new, ${skipped} duplicate(s) skipped`);
  return primaryRecords;
}

// Guarantee every cached record has a MeasureID, falling back to the Airtable record id.
function ensureMeasureID(records) {
  records.forEach(r => {
    if (!r.fields["MeasureID"]) {
      console.warn(`[ensureMeasureID] Record ${r.id} missing MeasureID — falling back to Airtable id.`);
      r.fields["MeasureID"] = r.id;
    }
  });
  return records;
}

async function downloadAttachmentList(list, localPathKey, pdfDir, urlPrefix, filenameSuffix = "") {
  if (!Array.isArray(list)) return 0;
  let count = 0;
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
      logDedupEvent(`[PDF] Duplicate filename "${safeFilename}" in the same attachment list — saving as "${candidate}"`);
      safeFilename = candidate;
    }
    seenFilenames.add(safeFilename);
    const localPath = path.join(pdfDir, safeFilename);

    if (!fs.existsSync(localPath)) {
      console.log(`⬇ Downloading ${origFilename} → ${safeFilename}`);
      try {
        const response = await fetch(attachment.url);
        if (!response.ok) {
          console.warn(`❌ Failed to download ${origFilename}`);
          continue;
        }
        fs.writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));
        count++;
      } catch (err) {
        console.error(`❌ Download error: ${origFilename}`, err);
      }
    }

    attachment[localPathKey] = `${urlPrefix}/${safeFilename}`;
  }
  return count;
}


// TABLE ID RESOLUTION **********************************************

export async function resolveTableIDs() {
  const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;
  console.log("Resolving Airtable table IDs from metadata API…");

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
    });
  } catch (err) {
    console.error("Metadata API request failed (network error):", err);
    return false;
  }

  if (response.status === 403) {
    console.error(
      "Metadata API returned 403 Forbidden — the PAT is missing the " +
      "'schema.bases:read' scope. Grant this scope in your Airtable account settings."
    );
    return false;
  }

  if (!response.ok) {
    console.error(`Metadata API returned unexpected status ${response.status}.`);
    return false;
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error("Failed to parse metadata API response:", err);
    return false;
  }

  const tables = data.tables || [];

  const measuresTable = tables.find(t => t.name === "Measures");
  const translationsTable = tables.find(t => t.name === "Translations");

  if (!measuresTable) {
    console.error(
      `[resolveTableIDs] Table "Measures" not found in base ${BASE_ID}. ` +
      "Cannot load measure data — check the base configuration."
    );
    return false;
  }

  MEASURES_TABLE_ID = measuresTable.id;
  console.log(`Resolved Measures table: ${MEASURES_TABLE_ID}`);

  const formView = (measuresTable.views || []).find(v => v.type === "form");
  if (formView) {
    SUBMIT_FORM_URL = `https://airtable.com/${BASE_ID}/${formView.id}`;
    console.log(`Resolved submit form URL: ${SUBMIT_FORM_URL}`);
  } else {
    console.warn("[resolveTableIDs] No form view found in Measures table — submit form link will be inactive.");
  }

  if (!translationsTable) {
    console.warn(
      `[resolveTableIDs] Table "Translations" not found in base ${BASE_ID}. ` +
      "Continuing without translations."
    );
  } else {
    TRANSLATIONS_TABLE_ID = translationsTable.id;
    console.log(`Resolved Translations table: ${TRANSLATIONS_TABLE_ID}`);
  }

  const contributorsTable = tables.find(t => t.name === "Contributors");
  if (!contributorsTable) {
    console.warn(
      `[resolveTableIDs] Table "Contributors" not found in base ${BASE_ID}. ` +
      "Continuing without contributors data."
    );
  } else {
    CONTRIBUTORS_TABLE_ID = contributorsTable.id;
    console.log(`Resolved Contributors table: ${CONTRIBUTORS_TABLE_ID}`);
  }

  // Secondary source (optional) — failure is a warning, not fatal
  if (AIRTABLE_PAT_2 && BASE_ID_2) {
    console.log("Resolving secondary Airtable table IDs…");
    try {
      const res2 = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID_2}/tables`, {
        headers: { Authorization: `Bearer ${AIRTABLE_PAT_2}` }
      });
      if (!res2.ok) {
        console.warn(`[resolveTableIDs] Secondary metadata API returned ${res2.status} — secondary source disabled.`);
      } else {
        const data2 = await res2.json();
        const tables2 = data2.tables || [];
        const mt2 = tables2.find(t => t.name === "Measures");
        const tt2 = tables2.find(t => t.name === "Translations");
        if (!mt2) {
          console.warn(`[resolveTableIDs] "Measures" not found in secondary base ${BASE_ID_2} — secondary source disabled.`);
        } else {
          MEASURES_TABLE_ID_2 = mt2.id;
          console.log(`Resolved secondary Measures table: ${MEASURES_TABLE_ID_2}`);
          if (tt2) {
            TRANSLATIONS_TABLE_ID_2 = tt2.id;
            console.log(`Resolved secondary Translations table: ${TRANSLATIONS_TABLE_ID_2}`);
          }
        }
      }
    } catch (err) {
      console.warn("[resolveTableIDs] Secondary metadata API request failed — secondary source disabled:", err.message);
    }
  }

  return true;
}


// CACHE TO DISK **********************************************

// Ensure root cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Load existing on-disk cache for each tenant at startup
{
  const slug = "relationships";
  const sliceDir = path.join(CACHE_DIR, slug);
  if (!fs.existsSync(sliceDir)) fs.mkdirSync(sliceDir, { recursive: true });
  const cacheFile = getCacheFile(slug);
  if (fs.existsSync(cacheFile)) {
    const raw = fs.readFileSync(cacheFile);
    tenantCaches.set(slug, ensureMeasureID(JSON.parse(raw).records));
  }
}

// Fetches measures and translations from all configured sources and rebuilds the unified cache.
export async function refreshCache(slug) {
  const cacheFile = getCacheFile(slug);
  const sliceDir = path.join(CACHE_DIR, slug);
  if (!fs.existsSync(sliceDir)) fs.mkdirSync(sliceDir, { recursive: true });

  let oldCache = [];
  let existingCacheContent = "";
  if (fs.existsSync(cacheFile)) {
    try {
      existingCacheContent = fs.readFileSync(cacheFile, "utf8");
      oldCache = JSON.parse(existingCacheContent).records || [];
    } catch (err) {
      console.error("Failed to read old cache:", err);
    }
  }

  // Primary measures
  console.log("Fetching Airtable data (primary source)…");
  let allRecords;
  try {
    allRecords = await fetchAllPages(AIRTABLE_PAT, BASE_ID, MEASURES_TABLE_ID, r => r.fields["Status"] === "Approved");
    allRecords.forEach(r => { delete r.fields["Full Measure (Required)"]; });
    console.log(`  Primary: ${allRecords.length} approved records`);
  } catch (err) {
    console.error("Error fetching primary Airtable data:", err);
    return;
  }

  // Secondary measures (optional)
  if (MEASURES_TABLE_ID_2) {
    console.log("Fetching Airtable data (secondary source)…");
    try {
      const secondary = await fetchAllPages(AIRTABLE_PAT_2, BASE_ID_2, MEASURES_TABLE_ID_2, r => r.fields["Status"] === "Approved");
      secondary.forEach(r => { delete r.fields["Full Measure (Required)"]; });
      console.log(`  Secondary: ${secondary.length} approved records (before dedup)`);
      allRecords = mergeWithDedup(allRecords, secondary, "secondary");
    } catch (err) {
      console.error("Error fetching secondary Airtable data — continuing with primary only:", err);
    }
  }

  // Update in-memory cache
  tenantCaches.set(slug, ensureMeasureID(allRecords));

  // Preserve existing local attachment paths
  for (const record of allRecords) {
    const old = oldCache.find(r => r.id === record.id);
    if (!old) continue;
    const newAttachments = record.fields.Attachments || [];
    const oldAttachments = old.fields.Attachments || [];
    newAttachments.forEach(att => {
      const oldMatch = oldAttachments.find(o => o.id === att.id);
      if (oldMatch && oldMatch.localPath && !att.localPath) att.localPath = oldMatch.localPath;
    });
  }

  // Translations from all sources, matched against the combined measure cache
  const allTranslations = [];

  if (TRANSLATIONS_TABLE_ID) {
    console.log("Fetching translation table (primary)…");
    try {
      const trs = await fetchAllPages(AIRTABLE_PAT, BASE_ID, TRANSLATIONS_TABLE_ID);
      allTranslations.push(...trs);
      console.log(`  Primary translations: ${trs.length}`);
    } catch (err) {
      console.error("Error fetching primary translations — skipping:", err);
    }
  }

  if (TRANSLATIONS_TABLE_ID_2) {
    console.log("Fetching translation table (secondary)…");
    try {
      const trs2 = await fetchAllPages(AIRTABLE_PAT_2, BASE_ID_2, TRANSLATIONS_TABLE_ID_2);
      allTranslations.push(...trs2);
      console.log(`  Secondary translations: ${trs2.length}`);
    } catch (err) {
      console.error("Error fetching secondary translations — skipping:", err);
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
        console.warn(`[translations] No primary record found for MeasureID "${measureID}"`);
      }
    }
  }
  if (allTranslations.length > 0) {
    console.log(`Merged ${matched} of ${allTranslations.length} translation records into cache.`);
  }

  const jsonString = JSON.stringify({ records: allRecords }, null, 2);
  fs.writeFileSync(cacheFile, jsonString);
  console.log(`Updated main cache: ${cacheFile} (${allRecords.length} records total)`);

  if (jsonString !== existingCacheContent) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(sliceDir, `cache-${timestamp}.json`);
    fs.writeFileSync(backupFile, jsonString);
    console.log(`Created backup: ${backupFile}`);
  } else {
    console.log("No changes detected — backup skipped.");
  }
}

export async function refreshContributors() {
  if (!CONTRIBUTORS_TABLE_ID) return;
  console.log("Fetching Contributors table…");
  const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${CONTRIBUTORS_TABLE_ID}`;
  const allRecords = [];
  try {
    let offset;
    do {
      const url = offset ? `${baseUrl}?offset=${encodeURIComponent(offset)}` : baseUrl;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_PAT}` }
      });
      if (!response.ok) {
        console.error(`Contributors table returned status ${response.status}. Skipping.`);
        return;
      }
      const page = await response.json();
      if (!page.records || !Array.isArray(page.records)) {
        console.error("Contributors response missing records. Skipping.");
        return;
      }
      allRecords.push(...page.records);
      offset = page.offset;
    } while (offset);
  } catch (err) {
    console.error("Error fetching contributors:", err);
    return;
  }
  contributorsCache = allRecords;
  console.log(`Loaded ${contributorsCache.length} contributor records.`);
}

// Save public stats for the cache-stats.json endpoint
export function refreshCounts(slug) {
  const cache = tenantCaches.get(slug) || [];
  let totalMeasures = 0;
  let totalConstructs = 0;
  let totalItems = 0;
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
  });

  totalConstructs = Object.keys(constructCounts).length;
  const statsJSON = JSON.stringify({
    slug,
    lastUpdated,
    totalMeasures,
    totalConstructs,
    totalItems,
    constructs: constructCounts,
  }, null, 2);

  const statsDir = path.join(process.cwd(), "public", slug);
  if (!fs.existsSync(statsDir)) fs.mkdirSync(statsDir, { recursive: true });
  fs.writeFileSync(path.join(statsDir, "cache-stats.json"), statsJSON, "utf8");
}

export async function syncLocalPDFs(slug) {
  const cacheFile = getCacheFile(slug);
  const pdfDir = getPdfDir(slug);
  const urlPrefix = `/${slug}/pdfs`;
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
  console.log("🔄 Checking Airtable cache for PDFs to sync...");

  if (!fs.existsSync(cacheFile)) {
    console.log("⚠ No cache file yet — skipping PDF sync.");
    return;
  }

  const raw = fs.readFileSync(cacheFile, "utf8");
  let json = JSON.parse(raw);

  const records = json.records || [];
  let downloads = 0;

  for (const record of records) {
    downloads += await downloadAttachmentList(record.fields["Full Measure (Required)"], "localPath", pdfDir, urlPrefix);
    downloads += await downloadAttachmentList(record.fields["Final PDF"], "f_localPath", pdfDir, urlPrefix);
    downloads += await downloadAttachmentList(record.fields["json file"], "j_localPath", pdfDir, urlPrefix);
    for (const tr of (record.fields.translations || [])) {
      const lang = tr["Language"] || "";
      downloads += await downloadAttachmentList(tr["Final PDF"], "f_localPath", pdfDir, urlPrefix, lang);
    }
  }

  fs.writeFileSync(cacheFile, JSON.stringify(json, null, 2), "utf8");
  if (downloads > 0) {
    console.log(`✔ PDF sync complete (${downloads} new files).`);
  } else {
    console.log("✔ No new PDFs needed.");
  }

  tenantCaches.set(slug, ensureMeasureID(json.records));
}

export async function runFullRefresh(slug) {
  try {
    console.log("Refreshing Airtable…");
    await refreshCache(slug);
    await refreshContributors();
    console.log("Syncing PDFs…");
    await syncLocalPDFs(slug);
    console.log("Counting records…");
    await refreshCounts(slug);
    lastRefreshTimes.set(slug, new Date());
    console.log("Cache + PDF sync complete.");
  } catch (err) {
    console.error("Error during scheduled refresh:", err);
  }
}
