// Single source of truth for path segments that must never be assigned as a tenant slug.
// In multi-tenant mode, server.js mounts landingRouter and architectRouter at the root,
// ahead of the `/:slug` catch-all — any top-level path they claim (e.g. "/search",
// "/request-repo", "/architect/...") permanently shadows a tenant of the same slug rather
// than 404ing, since the root-mounted router wins the match every time. Add new top-level
// routes here the moment they're added to one of those routers.
export const RESERVED_SLUGS = ["architect", "search", "request-repo", "analytics"];

// Verifies every top-level GET/POST path a root-mounted router defines is covered by
// RESERVED_SLUGS, so a route added to landingRouter/architectRouter without a matching
// update here fails loudly at startup instead of silently shadowing a future tenant.
// Called from server.js right after each router is constructed.
export function assertReservedSlugsCover(router, label) {
  const missing = new Set();
  for (const layer of router.stack) {
    const routePath = layer.route?.path;
    if (!routePath) continue;
    const segment = routePath.split("/")[1];
    if (segment && !RESERVED_SLUGS.includes(segment)) missing.add(segment);
  }
  if (missing.size) {
    throw new Error(
      `${label} defines top-level path(s) [${[...missing].join(", ")}] not present in ` +
      `RESERVED_SLUGS (lib/reservedSlugs.js) — add them there or a tenant could be created ` +
      `with a slug that gets silently shadowed.`
    );
  }
}
