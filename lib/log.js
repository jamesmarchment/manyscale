// lib/log.js
// Shared prefix for per-tenant log lines, used across server.js and lib/routes files
// that log tenant activity — keeps timestamp formatting consistent in one place.
export function tenantLogPrefix(slug) {
  return `[${new Date().toISOString()}] [${slug}]`;
}
