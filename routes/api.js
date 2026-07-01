import { Router } from "express";
import { tenantCaches, refreshCache } from "../lib/airtable.js";

const router = Router();

router.get("/api/data", async (req, res) => {
  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshCache(req.tenant.slug);
    cache = tenantCaches.get(req.tenant.slug) || [];
  }

  const id = req.query.id;

  if (id) {
    const record = cache.find(r => r.fields["MeasureID"] === id);
    return res.json({ records: record ? [record] : [] });
  }

  const sorted = [...cache].sort((a, b) =>
    (b.fields["Favorite"] ?? -Infinity) - (a.fields["Favorite"] ?? -Infinity)
  );
  res.json({ records: sorted });
});


router.get("/api/search", async (req, res) => {
  const query = (req.query.q || "").toLowerCase();

  let cache = tenantCaches.get(req.tenant.slug) || [];
  if (cache.length === 0) {
    await refreshCache(req.tenant.slug);
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
    await refreshCache(req.tenant.slug);
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
