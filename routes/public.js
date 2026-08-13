import { Router } from "express";
import fs from "fs";
import path from "path";
import { tenantCaches, refreshTenantCacheOnly, contributorsCache, getSubmitFormUrl } from "../lib/airtable.js";
import { recordMatchesSearch, getSuggestions } from "../lib/search.js";
import { measureMetaDescription, measureKeywords } from "../lib/seo.js";
import { PROJECT_ROOT } from "../config.js";

const router = Router();

router.get("/", (req, res) => {
  let team = [], hero = {}, submitFormUrl = getSubmitFormUrl(req.tenant.slug);
  try {
    const content = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "data", `${req.tenant.slug}.json`), "utf8"));
    team = content.team || [];
    hero = content.hero || {};
    if (content.submitFormUrl) submitFormUrl = content.submitFormUrl;
  } catch (err) {
    console.warn(`[content] Could not load data/${req.tenant.slug}.json:`, err.message);
  }

  const tenantContributors = contributorsCache.get(req.tenant.slug) || [];

  const contributors = tenantContributors
    .filter(r => r.fields["Role"] === "Contributor")
    .sort((a, b) => (b.fields["Measures"] || []).length - (a.fields["Measures"] || []).length);

  const funding = tenantContributors
    .filter(r => r.fields["Role"] === "Funding");

  const scaleCreators = tenantContributors
    .filter(r => r.fields["Role"] === "Scale Creator")
    .sort((a, b) => (b.fields["Measures"] || []).length - (a.fields["Measures"] || []).length);

  res.render("index", { team, hero, submitFormUrl, contributors, funding, scaleCreators, cacheStatsUrl: `/${req.tenant.slug}/cache-stats.json` });
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

  res.render("details", {
    id: recordId,
    record,
    prev,
    next,
    metaDescription: measureMetaDescription(record),
    metaKeywords: measureKeywords(record),
  });
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
  const cache = tenantCaches.get(req.tenant.slug) || [];
  res.json({ suggestions: getSuggestions(cache, query) });
});

router.get("/constructs", async (req, res) => {
  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshTenantCacheOnly(req.tenant.slug);
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
    await refreshTenantCacheOnly(req.tenant.slug);
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

router.get("/topics/:name", async (req, res) => {
  const name = req.params.name.trim();

  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshTenantCacheOnly(req.tenant.slug);
    cache = tenantCaches.get(req.tenant.slug) || [];
  }

  const topicMap = {};
  for (const record of cache) {
    const topics = record.fields["Topic(s)"];
    if (!topics) continue;
    topics.forEach(t => {
      const key = t.trim();
      if (!topicMap[key]) topicMap[key] = [];
      topicMap[key].push(record);
    });
  }

  const list = topicMap[name];
  if (!list) {
    return res.status(404).send("Topic not found");
  }

  res.render("topic-details", { name, items: list });
});

router.get("/languages", async (req, res) => {
  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshTenantCacheOnly(req.tenant.slug);
    cache = tenantCaches.get(req.tenant.slug) || [];
  }

  const languageMap = {};
  for (const record of cache) {
    for (const tr of (record.fields.translations || [])) {
      const lang = (tr["Language"] || "").trim();
      if (!lang) continue;
      if (!languageMap[lang]) languageMap[lang] = [];
      languageMap[lang].push(record);
    }
  }

  const languagesList = Object.keys(languageMap)
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({ name, items: languageMap[name] }));

  res.render("languages", { languages: languagesList });
});

router.get("/languages/:name", async (req, res) => {
  const name = req.params.name.trim();

  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshTenantCacheOnly(req.tenant.slug);
    cache = tenantCaches.get(req.tenant.slug) || [];
  }

  const languageMap = {};
  for (const record of cache) {
    for (const tr of (record.fields.translations || [])) {
      const lang = (tr["Language"] || "").trim();
      if (!lang) continue;
      if (!languageMap[lang]) languageMap[lang] = [];
      languageMap[lang].push(record);
    }
  }

  const list = languageMap[name];
  if (!list) {
    return res.status(404).send("Language not found");
  }

  res.render("language-details", { name, items: list });
});

router.get("/contributors", (req, res) => {
  const byMeasureCount = (a, b) =>
    (b.fields["Measures"] || []).length - (a.fields["Measures"] || []).length;

  const tenantContributors = contributorsCache.get(req.tenant.slug) || [];

  const coreTeam = tenantContributors
    .filter(r => r.fields["Role"] === "Core Team")
    .sort(byMeasureCount);

  const contributors = tenantContributors
    .filter(r => r.fields["Role"] === "Contributor")
    .sort(byMeasureCount);

  const funding = tenantContributors
    .filter(r => r.fields["Role"] === "Funding");

  const scaleCreators = tenantContributors
    .filter(r => r.fields["Role"] === "Scale Creator")
    .sort(byMeasureCount);

  res.render("contributors", { coreTeam, contributors, funding, scaleCreators });
});

router.get("/terms", (req, res) => {
  res.render("terms");
});

router.get("/privacy", (req, res) => {
  res.render("privacy");
});


export default router;
