import { Router } from "express";
import { tenantCaches, refreshTenantCacheOnly, readCacheStats } from "../lib/airtable.js";

const router = Router();

router.get("/api/data", async (req, res) => {
  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshTenantCacheOnly(req.tenant.slug);
    cache = tenantCaches.get(req.tenant.slug) || [];
  }

  const id = req.query.id;

  if (id) {
    const record = cache.find(r => r.fields["MeasureID"] === id);
    return res.json({ records: record ? [record] : [] });
  }

  // Preferred (Favorite) records always lead, but shouldn't render in the same
  // order every time — shuffle within each group rather than a stable sort.
  const shuffle = arr => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const preferred = cache.filter(r => r.fields["Favorite"]);
  const rest = cache.filter(r => !r.fields["Favorite"]);
  const sorted = [...shuffle(preferred), ...shuffle(rest)];
  res.json({ records: sorted.map(toListRecord) });
});

// Fields the index-page card grid (public/assets/js/index.js's renderPage) actually
// reads. The full record also carries long-text fields (Description, sample items, R
// code attachments, etc) and other attachment metadata that the card never displays —
// trimming those out keeps the list payload proportional to what's rendered instead of
// growing with the whole dataset on every page load. The single-record path above (?id=)
// still returns the full record, since the details page needs everything.
const LIST_CARD_FIELDS = ["MeasureID", "Measure Name", "Construct(s)", "Primary Reference", "Year", "Missing PDF"];

function toListRecord(r) {
  const fields = {};
  for (const key of LIST_CARD_FIELDS) {
    if (key in r.fields) fields[key] = r.fields[key];
  }
  // Only fields[0].f_localPath is ever read from "Final PDF" on the card grid — drop the
  // rest of the Airtable attachment metadata (url, filename, size, thumbnails).
  const localPath = r.fields["Final PDF"]?.[0]?.f_localPath;
  if (localPath) fields["Final PDF"] = [{ f_localPath: localPath }];
  return { id: r.id, fields };
}


router.get("/api/search", async (req, res) => {
  const query = (req.query.q || "").toLowerCase();

  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshTenantCacheOnly(req.tenant.slug);
    cache = tenantCaches.get(req.tenant.slug) || [];
  }

  const results = cache.filter(rec => {
    const field = rec.fields["Construct(s)"];
    if (!field) return false;
    return Array.isArray(field)
      ? field.some(item => item.toLowerCase().includes(query))
      : field.toLowerCase().includes(query);
  });

  res.json({ records: results });
});


// refreshCounts() (lib/airtable.js) already tallies this exact {constructName: count}
// map into cache-stats.json's "constructs" field once per scheduled Airtable refresh —
// read that instead of rescanning tenantCaches on every request.
router.get("/api/construct-stats", (req, res) => {
  res.json(readCacheStats(req.tenant.slug)?.constructs || {});
});


export default router;
