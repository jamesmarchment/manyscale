import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "../config.js";

// Atomically writes a JSON file: write to a temp file in the same directory, then
// rename over the target. fs.renameSync on the same filesystem is atomic, so a reader
// never observes a partially-written file, even if the process is killed mid-write.
export function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

const contentCache = new Map(); // tenant slug -> content object

function contentFilePath(slug) {
  return path.join(PROJECT_ROOT, "data", `${slug}.json`);
}

// Missing file (ENOENT) is a normal "tenant hasn't saved anything yet" state and
// defaults to {}. A file that exists but fails to parse is corrupt — that's thrown,
// not defaulted, so a caller mid-save can abort instead of writing a near-empty object
// over whatever's actually still recoverable on disk.
export function getTenantContent(slug) {
  if (contentCache.has(slug)) return contentCache.get(slug);
  const filePath = contentFilePath(slug);
  let content;
  try {
    content = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") content = {};
    else throw err;
  }
  contentCache.set(slug, content);
  return content;
}

// Read-modify-write for a tenant's data/{slug}.json: mutatorFn receives a clone of the
// current content and mutates it in place. Throws (without writing anything) if the
// existing file is corrupt — callers should catch this and flash an error rather than
// silently overwriting tenant data.
export function updateTenantContent(slug, mutatorFn) {
  const current = getTenantContent(slug);
  const next = structuredClone(current);
  mutatorFn(next);
  writeJsonAtomic(contentFilePath(slug), next);
  contentCache.set(slug, next);
  return next;
}

// Call when a tenant is deleted so its content doesn't linger in memory for the rest
// of the process's lifetime (mirrors tenantCaches.delete()/lastRefreshTimes.delete() in
// routes/architect.js's delete handler).
export function invalidateTenantContent(slug) {
  contentCache.delete(slug);
}
