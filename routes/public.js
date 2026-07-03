import { Router } from "express";
import fs from "fs";
import path from "path";
import { tenantCaches, refreshCache, contributorsCache, SUBMIT_FORM_URL } from "../lib/airtable.js";
import { recordMatchesSearch, SUGGESTION_STOP_WORDS } from "../lib/search.js";

const router = Router();

router.get("/", (req, res) => {
  let team = [], hero = {}, submitFormUrl = SUBMIT_FORM_URL;
  try {
    const content = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", `${req.tenant.slug}.json`), "utf8"));
    team = content.team || [];
    hero = content.hero || {};
    if (content.submitFormUrl) submitFormUrl = content.submitFormUrl;
  } catch (err) {
    console.warn(`[content] Could not load data/${req.tenant.slug}.json:`, err.message);
  }

  const contributors = contributorsCache
    .filter(r => r.fields["Role"] === "Contributor")
    .sort((a, b) => (b.fields["Measures"] || []).length - (a.fields["Measures"] || []).length);

    
  const funding = contributorsCache
    .filter(r => r.fields["Role"] === "Funding");

  res.render("index", { team, hero, submitFormUrl, contributors, funding,cacheStatsUrl: `/${req.tenant.slug}/cache-stats.json` });
});

router.get("/details/", (req, res) => {
  res.redirect("/");
});

router.get("/details/:id", async (req, res) => {
  const recordId = req.params.id;

  const cache = tenantCaches.get(req.tenant.slug) || [];
  const index = cache.findIndex(r => r.fields["MeasureID"] === recordId);

  if (index === -1) {
    return res.status(404).send("Record not found");
  }

  const record = cache[index];
  const prev = cache[(index - 1 + cache.length) % cache.length];
  const next = cache[(index + 1) % cache.length];

  res.render("details", { id: recordId, record, prev, next });
});

router.get("/search", (req, res) => {
  const rawQuery = (req.query.query || "").replace(/[\r\n]+/g, " ").trim();
  const query = rawQuery.toLowerCase();

  const cache = tenantCaches.get(req.tenant.slug) || [];
  let results = [];
  if (query) {
    results = cache.filter(record => recordMatchesSearch(record, query));
  }

  res.render("search", { query: rawQuery, results });
});

router.get("/search/suggestions", (req, res) => {
  const query = (req.query.query || "").trim();
  const lower = query.toLowerCase();
  if (query.length < 3 || SUGGESTION_STOP_WORDS.has(lower)) return res.json({ suggestions: [] });

  const seen = new Set();
  const suggestions = [];

  const cache = tenantCaches.get(req.tenant.slug) || [];
  for (const record of cache) {
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

router.get("/constructs", async (req, res) => {
  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshCache(req.tenant.slug);
    cache = tenantCaches.get(req.tenant.slug) || [];
  }

  const constructMap = {};
  for (const record of cache) {
    const constructs = record.fields["Construct(s)"];
    if (!constructs) continue;
    constructs.forEach(c => {
      const key = c.trim();
      if (!constructMap[key]) constructMap[key] = [];
      constructMap[key].push(record);
    });
  }

  const constructsList = Object.keys(constructMap)
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({ name, items: constructMap[name] }));

  res.render("constructs", { constructs: constructsList });
});

router.get("/constructs/:name", async (req, res) => {
  const name = req.params.name.trim();

  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshCache(req.tenant.slug);
    cache = tenantCaches.get(req.tenant.slug) || [];
  }

  const constructMap = {};
  for (const record of cache) {
    const constructs = record.fields["Construct(s)"];
    if (!constructs) continue;
    constructs.forEach(c => {
      const key = c.trim();
      if (!constructMap[key]) constructMap[key] = [];
      constructMap[key].push(record);
    });
  }

  const list = constructMap[name];
  if (!list) {
    return res.status(404).send("Construct not found");
  }

  res.render("construct-details", { name, items: list });
});

router.get("/contributors", (req, res) => {
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

router.get("/terms", (req, res) => {
  res.render("terms");
});

router.get("/privacy", (req, res) => {
  res.render("privacy");
});


export default router;
