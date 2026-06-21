// server.js
/*

ManyScale Server
v0.0.1
2026-06-14
James Marchment and Samantha Joel

*/

// imports
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// configuration
dotenv.config();

const app = express();
const port = process.env.PORT || 3007;


// using EJS
app.set("view engine", "ejs");

app.use(cors()); 
app.use(express.json());                          
app.use(express.urlencoded({ extended: true }));  

// static files
app.use(express.static("public"));


const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const BASE_ID = process.env.BASE_ID;

if (!AIRTABLE_PAT || !BASE_ID) {
  console.error("Missing environment variables. Check .env file.");
  process.exit(1);
}

// Optional secondary data source — set both to enable; merged into cache at startup
const AIRTABLE_PAT_2 = process.env.AIRTABLE_PAT_2 || null;
const BASE_ID_2 = process.env.BASE_ID_2 || null;

// Resolved once at startup via the metadata API — never read from .env
let MEASURES_TABLE_ID = null;
let TRANSLATIONS_TABLE_ID = null;
let CONTRIBUTORS_TABLE_ID = null;

let MEASURES_TABLE_ID_2 = null;
let TRANSLATIONS_TABLE_ID_2 = null;

// email
const transporter = nodemailer.createTransport({
  host: "mail.manyscale.org",
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});





// MULTI-SOURCE HELPERS **********************************************

const LOG_FILE = path.join(__dirname, "server.log");

function logDedupEvent(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line, "utf8");
  console.log(message);
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


// TABLE ID RESOLUTION **********************************************

async function resolveTableIDs() {
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


// CACHE TO DISK FROM SERVER **********************************************

// In-memory cache
let airtableCache = [];
let contributorsCache = [];

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

// On-disk cache

// cache the Airtable DB

const CACHE_DIR = "./cache";
const CACHE_FILE = path.join(CACHE_DIR, "cache.json");

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Load cache from disk when server starts
if (fs.existsSync(CACHE_FILE)) {
  const raw = fs.readFileSync(CACHE_FILE);
  airtableCache = ensureMeasureID(JSON.parse(raw).records);
}


// Fetches measures and translations from all configured sources and rebuilds the unified cache.
async function refreshCache() {
  let oldCache = [];
  if (fs.existsSync(CACHE_FILE)) {
    try {
      oldCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")).records || [];
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
  airtableCache = ensureMeasureID(allRecords);

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
  fs.writeFileSync(CACHE_FILE, jsonString);
  console.log(`Updated main cache: ${CACHE_FILE} (${allRecords.length} records total)`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(CACHE_DIR, `cache-${timestamp}.json`);
  fs.writeFileSync(backupFile, jsonString);
  console.log(`Created backup: ${backupFile}`);
}




async function refreshContributors() {
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


// Save out some public stats for later
function refreshCounts() {
  let totalMeasures = 0;
  let totalConstructs = 0;
  let totalItems = 0;
  let lastUpdated = new Date();
  
  const constructCounts = {};
  airtableCache.forEach(record => {
  const fields = record.fields;

  // Count measures
  totalMeasures++;

  // Count constructs
  const constructs = fields["Construct(s)"];
  if (Array.isArray(constructs)) {
    constructs.forEach(c => {
      constructCounts[c] = (constructCounts[c] || 0) + 1;
    });
  }

  // Count total items
  const numItems = fields["Number of Items"];
  if (typeof numItems === "number") {
    totalItems += numItems;
  }
});

  // Unique construct count (not total tags across all measures)
  totalConstructs = Object.keys(constructCounts).length;
  const statsJS = `
window.MeasureStats = {
  lastUpdated: "${lastUpdated}",
  totalMeasures: ${totalMeasures},
  totalConstructs: ${totalConstructs},
  totalItems: ${totalItems},
  constructs: ${JSON.stringify(constructCounts, null, 2)}
};
`;

fs.writeFileSync(path.join(__dirname, "public/cache-stats.js"), statsJS, "utf8");
}

// ROUTES AND FUNCTIONS **********************************************
// search function

function recordMatchesSearch(record, query) {
  const fields = record.fields;
  const constructs = Array.isArray(fields["Construct(s)"]) ? fields["Construct(s)"] : [];
  const translationLangs = (fields.translations || []).map(tr => tr["Language"]).filter(Boolean);

  // Whole-query substring match against name, reference, description, constructs, or translation languages
  if (fields["Measure Name"]?.toLowerCase().includes(query)) return true;
  if (fields["Primary Reference"]?.toLowerCase().includes(query)) return true;
  if (fields["Description of Measure"]?.toLowerCase().includes(query)) return true;
  if (constructs.some(c => c.toLowerCase().includes(query))) return true;
  if (translationLangs.some(l => l.toLowerCase().includes(query))) return true;

  // Multi-keyword match: split the query into tokens, drop stop words, and return
  // true if every token appears somewhere across all searchable fields combined.
  const stopWords = new Set(['a','an','the','and','or','of','in','to','for','with','on','at','by','from']);
  const tokens = query.split(/\W+/).filter(t => t.length > 1 && !stopWords.has(t));
  if (tokens.length >= 2) {
    const fullText = [
      fields["Measure Name"] ?? "",
      fields["Primary Reference"] ?? "",
      fields["Description of Measure"] ?? "",
      ...constructs,
      ...translationLangs,
    ].join(" ").toLowerCase();
    return tokens.every(token => fullText.includes(token));
  }

  return false;
}



// routes -- refactored in 0.0.1 to pull from cache instead of API call


// PAGES -- ALL PAGES IN SITE NEED TO BE LISTED HERE
// RENDER pages **********************************************

const TEAM_FILE = path.join(__dirname, "data/team.json");

// index
app.get("/", (req, res) => {
  let team = [];
  try {
    team = JSON.parse(fs.readFileSync(TEAM_FILE, "utf8"));
  } catch (err) {
    console.warn("[team] Could not load team.json:", err.message);
  }
  res.render("index", { team });
});

// details
app.get("/details/:id", async (req, res) => {
  const recordId = req.params.id;
  
  
  // Find the index of this record
  const index = airtableCache.findIndex(r => r.fields["MeasureID"] === recordId);

  if (index === -1) {
    return res.status(404).send("Record not found");
  }

  const record = airtableCache[index];

  // Get previous and next, with bounds checking
  const prev = airtableCache[(index - 1 + airtableCache.length) % airtableCache.length];
  const next = airtableCache[(index + 1) % airtableCache.length];
  
  
  res.render("details", { id: recordId,
	record,
    prev,
    next  });
});
	// if no id supplied, go to index
app.get("/details/", (req, res) => {
  res.redirect("/");
});

// search
app.get("/search", (req, res) => {
  const rawQuery = (req.query.query || "").replace(/[\r\n]+/g, " ").trim();
  const query = rawQuery.toLowerCase();

  // If no query provided, return empty result set
  let results = [];
  if (query) {
    results = airtableCache.filter(record =>
      recordMatchesSearch(record, query)
    );
  }

  res.render("search", {
    query: rawQuery,
    results
  });
});

// search autocomplete suggestions
const SUGGESTION_STOP_WORDS = new Set(['a','an','the','and','or','of','in','to','for','with','on','at','by','from']);

app.get("/search/suggestions", (req, res) => {
  const query = (req.query.query || "").trim();
  const lower = query.toLowerCase();
  if (query.length < 3 || SUGGESTION_STOP_WORDS.has(lower)) return res.json({ suggestions: [] });

  const seen = new Set();
  const suggestions = [];

  for (const record of airtableCache) {
    if (suggestions.length >= 6) break;
    const fields = record.fields;
    const candidates = [
      fields["Measure Name"],
      fields["Primary Reference"],
      ...(Array.isArray(fields["Construct(s)"]) ? fields["Construct(s)"] : []),
    ];
    for (const val of candidates) {
      if (suggestions.length >= 6) break;
      if (typeof val !== "string") continue;
      const hasMatch = val.split(/\W+/).some(
        w => w.toLowerCase().startsWith(lower) && !SUGGESTION_STOP_WORDS.has(w.toLowerCase())
      );
      if (hasMatch) {
        const key = val.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push(val);
        }
      }
    }
  }

  res.json({ suggestions });
});

// constructs index
app.get("/constructs", async (req, res) => {
  // Make sure the cache is loaded
  if (airtableCache.length === 0) {
    await refreshCache();
  }
  // Group constructs → record list
  const constructMap = {};

  for (const record of airtableCache) {
    const constructs = record.fields["Construct(s)"]; 

    if (!constructs) continue;
    constructs.forEach(c => {
      const key = c.trim();
      if (!constructMap[key]) {
        constructMap[key] = [];
      }
      constructMap[key].push(record);
    });
  }
  // Convert to sorted array the way EJS expects
  const constructsList = Object.keys(constructMap)
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({
      name,
      items: constructMap[name]
    }));
  res.render("constructs", { constructs: constructsList });
});


// constructs page per construct
app.get("/constructs/:name", async (req, res) => {
  
  const name = req.params.name.trim();

 // Make sure the cache is loaded
  if (airtableCache.length === 0) {
    await refreshCache();
  }
  // Group constructs → record list
  const constructMap = {};


  for (const record of airtableCache) {
    const constructs = record.fields["Construct(s)"];
    if (!constructs) continue;

    constructs.forEach(c => {
      const key = c.trim();
      if (!constructMap[key]) {
        constructMap[key] = [];
      }
      constructMap[key].push(record);
    });
  }
  
   const list = constructMap[name];

  if (!list) {
    return res.status(404).send("Construct not found");
  }

  res.render("construct-details", {
  name,      // string, ex: "Trust"
  items: list // array of Airtable records under that construct
  });


});


// contributors
app.get("/contributors", (req, res) => {
  const byMeasureCount = (a, b) =>
    (b.fields["Measures"] || []).length - (a.fields["Measures"] || []).length;

  const coreTeam = contributorsCache
    .filter(r => r.fields["Role"] === "Core Team")
    .sort(byMeasureCount);

  const contributors = contributorsCache
    .filter(r => r.fields["Role"] === "Contributor")
    .sort(byMeasureCount);

  const funding = contributorsCache
    .filter(r => r.fields["Role"] === "Funding");

  res.render("contributors", { coreTeam, contributors, funding });
});

// terms of service
app.get("/terms", (req, res) => {
  res.render("terms");
});

// privacy policy
app.get("/privacy", (req, res) => {
  res.render("privacy");
});


// contact form (post, not get) .................................................................................................

// in-memory rate limiter: max 5 submissions per IP per hour
const _contactRateMap = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function contactRateLimitOk(ip) {
  const now = Date.now();
  const entry = _contactRateMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    _contactRateMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

app.post("/contact", async (req, res) => {
  const { name, email, subject, message, website, _t } = req.body;

  // honeypot: real users leave this blank
  if (website && website.trim() !== "") {
    return res.status(200).json({ success: true });
  }

  // timing: reject submissions that arrive under 3 seconds after page render
  const elapsed = Date.now() - parseInt(_t || 0, 10);
  if (elapsed < 3000) {
    return res.status(429).json({ error: "Submission too fast. Please try again." });
  }

  // rate limit by IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip;
  if (!contactRateLimitOk(ip)) {
    return res.status(429).json({ error: "Too many messages. Please try again later." });
  }

  try {
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: process.env.CONTACT_RECIPIENT || process.env.SMTP_USER,
      subject: `New Contact Form Message from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\nSubject: ${subject}\n\nMessage:\n${message}`
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Contact form error:", err);
    res.status(500).json({ error: "Email failed to send" });
  }
});


// suggest a measure form .....................................................................

app.post("/suggest", async (req, res) => {
  const { name, email, measure_name, citation, comments, website, _t } = req.body;

  // honeypot
  if (website && website.trim() !== "") {
    return res.status(200).json({ success: true });
  }

  // timing: reject submissions under 3 seconds after modal open
  const elapsed = Date.now() - parseInt(_t || 0, 10);
  if (elapsed < 3000) {
    return res.status(429).json({ error: "Submission too fast. Please try again." });
  }

  // rate limit: reuse the same IP map as the contact form
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.ip;
  if (!contactRateLimitOk(ip)) {
    return res.status(429).json({ error: "Too many submissions. Please try again later." });
  }

  try {
    const body = [
      `Name:    ${name}`,
      `Email:   ${email}`,
      ``,
      `Measure: ${measure_name}`,
      ``,
      `Citation:`,
      citation,
      ...(comments ? [``, `Comments:`, comments] : []),
    ].join("\n");

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.CONTACT_RECIPIENT || process.env.SMTP_USER,
      subject: `Measure Suggestion: ${measure_name}`,
      text: body,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Suggest form error:", err);
    res.status(500).json({ error: "Email failed to send" });
  }
});




// DATA ******************************************************************************************************************************************
// data response -- pulls entire table
app.get("/api/data", async (req, res) => {
  if (airtableCache.length === 0) {
    await refreshCache();
  }

  const id = req.query.id;

  if (id) {
    const record = airtableCache.find(r => r.fields["MeasureID"] === id);
    return res.json({ records: record ? [record] : [] });
  }
// ****** HERE IS WHERE WE ORDER THINGS <<<<<<-------------
  const sorted = [...airtableCache].sort((a, b) =>
    (b.fields["Favorite"] ?? -Infinity) - (a.fields["Favorite"] ?? -Infinity)
  );
  res.json({ records: sorted });
});


// double-check that server started up, save to log
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});



// SEARCH ******************************************************************************************************************************************
app.get("/api/search", async (req, res) => {
  const query = (req.query.q || "").toLowerCase();

  if (airtableCache.length === 0) {
    await refreshCache();
  }

  // filter search without hitting Airtable
  const results = airtableCache.filter(rec => {
    const field = rec.fields["Construct(s)"];
    if (!field) return false;
    return Array.isArray(field)
      ? field.some(item => item.toLowerCase().includes(query))
      : field.toLowerCase().includes(query);
  });

  res.json({ records: results });
});


// COUNT **********************************************
app.get("/api/construct-stats", async (req, res) => {
  if (airtableCache.length === 0) {
    await refreshCache();
  }

  const counts = {};

  airtableCache.forEach(rec => {
    const constructs = rec.fields["Construct(s)"];
    if (!constructs) return;

    const list = Array.isArray(constructs) ? constructs : [constructs];

    list.forEach(c => {
      counts[c] = (counts[c] || 0) + 1;
    });
  });

  res.json(counts);
});


// SAVING THE PDFS LOCALLY

const PDF_DIR = path.join(process.cwd(), "public/pdfs");
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR);


async function downloadAttachmentList(list, localPathKey, filenameSuffix = "") {
  if (!Array.isArray(list)) return 0;
  let count = 0;
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
    const safeFilename = `${safeBaseName}${safeSuffix}_${attachment.id.slice(-4)}${ext}`;
    const localPath = path.join(PDF_DIR, safeFilename);

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

    attachment[localPathKey] = `/pdfs/${safeFilename}`;
  }
  return count;
}

/**
 * Scans the local cache, finds PDFs referenced in the Airtable fields,
 * downloads them locally if missing, updates each record's attachment
 * info to include localPath, and re-saves updated cache.json.
 */
export async function syncLocalPDFs() {
  console.log("🔄 Checking Airtable cache for PDFs to sync...");

  // Load cache — if missing, nothing to do
  if (!fs.existsSync(CACHE_FILE)) {
    console.log("⚠ No cache file yet — skipping PDF sync.");
    return;
  }

  const raw = fs.readFileSync(CACHE_FILE, "utf8");
  let json = JSON.parse(raw);

  const records = json.records || [];

  let downloads = 0;

  for (const record of records) {
    downloads += await downloadAttachmentList(record.fields["Full Measure (Required)"], "localPath");
    downloads += await downloadAttachmentList(record.fields["Final PDF"], "f_localPath");
    for (const tr of (record.fields.translations || [])) {
      const lang = tr["Language"] || "";
      downloads += await downloadAttachmentList(tr["Final PDF"], "f_localPath", lang);
    }
  }

  // If any files changed, save Cache with updated localPaths
  if (downloads > 0) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(json, null, 2), "utf8");
    console.log(`✔ PDF sync complete (${downloads} new files).`);
  } else {
	  // write it anyway, because the cache update is removing local paths from cache.js
    fs.writeFileSync(CACHE_FILE, JSON.stringify(json, null, 2), "utf8");
    console.log("✔ No new PDFs needed.");
  }

  airtableCache = ensureMeasureID(json.records);
}

app.get("/admin/sync-pdfs", async (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  await syncLocalPDFs();
  res.send("PDF sync completed");
});

app.get("/admin/refresh-cache", async (req, res) => {
  if (req.query.token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send("Unauthorized");
  }
  await refreshCache();
  res.send(`Cache refreshed. ${airtableCache.length} records loaded.`);
});



// KEEP THIS AT THE BOTTOM -- just so it doesn't try to do anything that hasn't been declared yet

async function runFullRefresh() {
	try {
  console.log("Refreshing Airtable…");
  await refreshCache();
  await refreshContributors();
  console.log("Syncing PDFs…");
  await syncLocalPDFs();
  console.log("Counting records…");
  await refreshCounts();  
  console.log("Cache + PDF sync complete.");
  } catch (err) {
    console.error("Error during scheduled refresh:", err);
  }
}

/*
refreshCache()
  .then(syncLocalPDFs)
  .then(refreshCounts)
  .then(() => console.log("Cache + PDF sync complete."))
  .catch(console.error);
*/

// Resolve table IDs once at startup, then kick off the data refresh cycle
console.log("Starting ManyScale…");
resolveTableIDs().then(ok => {
  if (!ok) {
    console.error("Table ID resolution failed — data will not be loaded. Fix the error above and restart.");
    return;
  }
  runFullRefresh();
  setInterval(runFullRefresh, 6 * 60 * 60 * 1000);
});
