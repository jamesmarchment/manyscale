import fs from "fs";
import path from "path";
import { PROJECT_ROOT, SITE_URL, MULTI_TENANT, primaryTenant, _tenantsList } from "../config.js";

// XML-escapes text content for <loc>/<lastmod> nodes. Defense-in-depth: construct/topic/
// language names are also encodeURIComponent'd before landing here, which already
// neutralizes these characters, but measure names and other free-text metadata aren't.
export function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const STATIC_PAGES = ["/", "/constructs", "/languages", "/contributors", "/terms", "/privacy"];

function urlEntry(loc, lastmod) {
  return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod.toISOString()}</lastmod>\n  </url>`;
}

// Pure — takes records rather than importing tenantCaches, so this module has no
// dependency on lib/airtable.js (avoids a circular import).
export function buildSitemapXml({ siteUrl, slug, records, generatedAt }) {
  const basePath = MULTI_TENANT ? "/" + slug : "";
  const origin = siteUrl + basePath;
  const entries = [];

  for (const page of STATIC_PAGES) {
    entries.push(urlEntry(origin + page, generatedAt));
  }

  const constructMap = new Map();
  const topicMap = new Map();
  const languageMap = new Map();

  for (const record of records) {
    entries.push(urlEntry(`${origin}/details/${record.fields["MeasureID"]}`, new Date(record.createdTime)));

    for (const c of record.fields["Construct(s)"] || []) {
      constructMap.set(c.trim(), true);
    }
    for (const t of record.fields["Topic(s)"] || []) {
      topicMap.set(t.trim(), true);
    }
    for (const tr of record.fields.translations || []) {
      const lang = (tr["Language"] || "").trim();
      if (lang) languageMap.set(lang, true);
    }
  }

  for (const name of constructMap.keys()) {
    entries.push(urlEntry(`${origin}/constructs/${encodeURIComponent(name)}`, generatedAt));
  }
  for (const name of topicMap.keys()) {
    entries.push(urlEntry(`${origin}/topics/${encodeURIComponent(name)}`, generatedAt));
  }
  for (const name of languageMap.keys()) {
    entries.push(urlEntry(`${origin}/languages/${encodeURIComponent(name)}`, generatedAt));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`;
}

function writeSitemapFile(dir, xml) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "sitemap.xml"), xml, "utf8");
}

// Called at the end of each tenant's refresh cycle (lib/airtable.js's runFullRefresh) —
// reads only the records already fetched this cycle, no new Airtable calls.
export function generateSitemap(slug, records, generatedAt = new Date()) {
  if (!SITE_URL) {
    console.warn(`[${slug}] SITE_URL is not set — skipping sitemap.xml (sitemap <loc> entries must be absolute URLs).`);
    return;
  }

  const xml = buildSitemapXml({ siteUrl: SITE_URL, slug, records, generatedAt });
  writeSitemapFile(path.join(PROJECT_ROOT, "public", slug), xml);

  // Single-tenant deployments serve this tenant at the site root, so crawlers look for
  // the sitemap at the conventional root path too, not just the per-slug copy above.
  if (!MULTI_TENANT && slug === primaryTenant.slug) {
    writeSitemapFile(path.join(PROJECT_ROOT, "public"), xml);
  }
}

const ROBOTS_HEADER = "User-agent: *\nAllow: /\nDisallow: /architect/\nDisallow: /admin/\nDisallow: /*/admin/\n";

// Zero Airtable/cache dependency — reads tenant config only, so it can run at startup
// before any refresh cycle has ever completed.
export function generateRobotsTxt() {
  const sitemapLines = [];

  if (!SITE_URL) {
    console.warn("[robots.txt] SITE_URL is not set — writing robots.txt without any Sitemap: lines.");
  } else if (!MULTI_TENANT) {
    if (primaryTenant.active !== false && !primaryTenant.externalUrl) {
      sitemapLines.push(`Sitemap: ${SITE_URL}/sitemap.xml`);
    }
  } else {
    const included = _tenantsList.filter(t => t.active !== false && !t.externalUrl);
    for (const tenant of included) {
      sitemapLines.push(`Sitemap: ${SITE_URL}/${tenant.slug}/sitemap.xml`);
    }
  }

  const content = sitemapLines.length > 0
    ? `${ROBOTS_HEADER}\n${sitemapLines.join("\n")}\n`
    : `${ROBOTS_HEADER}`;

  fs.mkdirSync(path.join(PROJECT_ROOT, "public"), { recursive: true });
  fs.writeFileSync(path.join(PROJECT_ROOT, "public", "robots.txt"), content, "utf8");
}
