import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { PROJECT_ROOT } from "../config.js";
import { writeJsonAtomic, getTenantContent, updateTenantContent } from "../lib/jsonStore.js";

// Uses obviously-fake tenant slugs under the real data/ directory (this module has no
// injectable base path) — every slug used here is cleaned up in `after()` so nothing is
// left behind for a real tenant to collide with.
const testSlugs = [];
function testContentFile(slug) {
  testSlugs.push(slug);
  return path.join(PROJECT_ROOT, "data", `${slug}.json`);
}

after(() => {
  for (const slug of testSlugs) {
    try { fs.unlinkSync(path.join(PROJECT_ROOT, "data", `${slug}.json`)); } catch {}
  }
});

test("writeJsonAtomic writes content that reads back correctly, with no leftover temp file", () => {
  const target = path.join(os.tmpdir(), `jsonstore-atomic-test-${Date.now()}.json`);
  writeJsonAtomic(target, { hello: "world", n: 42 });
  const readBack = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.deepEqual(readBack, { hello: "world", n: 42 });
  const leftoverTmp = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(path.basename(target)) && f.endsWith(".tmp"));
  assert.equal(leftoverTmp.length, 0, "no .tmp file should remain after a successful write");
  fs.unlinkSync(target);
});

test("getTenantContent returns {} for a tenant with no content file yet", () => {
  const slug = "__jsonstore_test_missing__";
  testContentFile(slug); // registers for cleanup even though nothing is written
  assert.deepEqual(getTenantContent(slug), {});
});

test("getTenantContent throws (does not silently default) on a corrupt content file", () => {
  const slug = "__jsonstore_test_corrupt__";
  const file = testContentFile(slug);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "{ not valid json", "utf8");
  assert.throws(() => getTenantContent(slug));
});

test("updateTenantContent round-trips a mutation to disk and to the in-memory cache", () => {
  const slug = "__jsonstore_test_update__";
  const file = testContentFile(slug);
  updateTenantContent(slug, (content) => { content.foo = "bar"; });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { foo: "bar" });

  // Delete the underlying file, then read again — a cache hit must still return the
  // correct value without re-touching disk, proving updateTenantContent populates the
  // cache rather than only writing through it.
  fs.unlinkSync(file);
  assert.deepEqual(getTenantContent(slug), { foo: "bar" });
});
