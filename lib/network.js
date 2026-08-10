import fs from "fs";
import path from "path";
import { _tenantsList, PROJECT_ROOT } from "../config.js";
import { tenantCaches } from "./airtable.js";
import { recordMatchesSearch, getSuggestions } from "./search.js";

// Cross-tenant helpers for the network landing page — everything here only ever
// considers active tenants, and (unlike the per-tenant routes) has no single
// req.tenant to scope to, so slug is tracked explicitly per record/result.

export function getActiveTenants() {
  return _tenantsList.filter(t => t.active !== false);
}

function readTenantContent(slug) {
  try {
    const content = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "data", `${slug}.json`), "utf8"));
    // landingTagline is the blurb shown on the network landing page's repository cards —
    // separate from meta.description (used for the tenant site's own SEO/social tags),
    // since the phrasing that reads well in a search snippet isn't always what you want
    // a human browsing the repository list to see. Falls back to meta.description for
    // tenants that haven't set it yet, so existing cards don't go blank.
    const tagline = content.landingTagline || content.meta?.description || "";
    return {
      tagline,
      logoColor: content.logoColor || "",
      // Landing-card accents fall back to the tenant's existing logoColor (so a card
      // looks branded before anyone touches the new admin fields), then to the card
      // template's own defaults.
      landingHeaderColor: content.landingHeaderColor || content.logoColor || "#f5e642",
      landingAccentColor: content.landingAccentColor || content.logoColor || "#e8180a",
    };
  } catch {
    return { tagline: "", logoColor: "", landingHeaderColor: "#f5e642", landingAccentColor: "#e8180a" };
  }
}

function readCacheStats(slug) {
  try {
    const stats = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "public", slug, "cache-stats.json"), "utf8"));
    return {
      totalMeasures: stats.totalMeasures || 0,
      totalConstructs: stats.totalConstructs || 0,
      totalTranslations: stats.totalTranslations || 0,
      constructs: stats.constructs || {},
    };
  } catch {
    return { totalMeasures: 0, totalConstructs: 0, totalTranslations: 0, constructs: {} };
  }
}

export function getTenantSummaries() {
  return getActiveTenants().map(t => {
    const { tagline, logoColor, landingHeaderColor, landingAccentColor } = readTenantContent(t.slug);
    const stats = readCacheStats(t.slug);
    const topConstructs = Object.entries(stats.constructs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
    return {
      slug: t.slug,
      name: t.name,
      tagline,
      logoColor,
      landingHeaderColor,
      landingAccentColor,
      markedNew: t.markedNew === true,
      externalUrl: t.externalUrl || "",
      measureCount: stats.totalMeasures,
      constructCount: stats.totalConstructs,
      translationCount: stats.totalTranslations,
      topConstructs,
    };
  });
}

export function searchNetwork({ query = "", lang = "" } = {}) {
  const results = [];
  for (const tenant of getActiveTenants()) {
    const cache = tenantCaches.get(tenant.slug) || [];
    if (cache.length === 0) continue;
    const { logoColor } = readTenantContent(tenant.slug);
    for (const record of cache) {
      if (query && !recordMatchesSearch(record, query)) continue;
      if (lang && !(record.fields.translations || []).some(tr => tr["Language"] === lang)) continue;
      results.push({ tenantSlug: tenant.slug, tenantName: tenant.name, tenantLogoColor: logoColor, record });
    }
  }
  return results;
}

export function getNetworkSuggestions(query) {
  const seen = new Set();
  const suggestions = [];
  for (const tenant of getActiveTenants()) {
    if (suggestions.length >= 6) break;
    const cache = tenantCaches.get(tenant.slug) || [];
    suggestions.push(...getSuggestions(cache, query, { seen, limit: 6 - suggestions.length }));
  }
  return suggestions;
}

export function getNetworkLanguages() {
  const languages = new Set();
  for (const tenant of getActiveTenants()) {
    const cache = tenantCaches.get(tenant.slug) || [];
    for (const record of cache) {
      for (const tr of record.fields.translations || []) {
        if (tr["Language"]) languages.add(tr["Language"]);
      }
    }
  }
  return [...languages].sort((a, b) => a.localeCompare(b));
}
