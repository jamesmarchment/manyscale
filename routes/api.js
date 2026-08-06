import { Router } from "express";
import { tenantCaches, refreshTenantCacheOnly } from "../lib/airtable.js";

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
  res.json({ records: sorted });
});


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


router.get("/api/construct-stats", async (req, res) => {
  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshTenantCacheOnly(req.tenant.slug);
    cache = tenantCaches.get(req.tenant.slug) || [];
  }

  const counts = {};

  cache.forEach(rec => {
    const constructs = rec.fields["Construct(s)"];
    if (!constructs) return;

    const list = Array.isArray(constructs) ? constructs : [constructs];

    list.forEach(c => {
      counts[c] = (counts[c] || 0) + 1;
    });
  });

  res.json(counts);
});


export default router;
