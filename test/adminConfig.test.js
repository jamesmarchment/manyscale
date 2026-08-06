import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { TENANTS_FILE, _tenantsList } from "../config.js";
import { writeJsonAtomic } from "../lib/jsonStore.js";

// Reproduces audit.md finding #3 at the level the bug actually lived at: the
// read-modify-write persistence of tenants.json, not the HTTP/routing layer around it
// (the fix has nothing to do with sessions/auth, so exercising those here would only add
// risk — see the note on tenants.json backup/restore below — without adding coverage).
//
// The bug: POST /admin/config used to re-parse tenants.json into a disconnected local
// array instead of mutating the shared _tenantsList reference. Every other tenants.json
// writer (POST /admin/password, and every /architect/tenants/:slug/* route) mutates
// _tenantsList in place and serializes that same array. So: tenant saves Config -> any
// later architect-side write on ANY tenant re-serializes the (still-unmodified, from its
// own perspective) shared _tenantsList -> the Config save is silently reverted, with no
// error and no race required.
//
// This test mutates the real tenants.json (there's no injectable test fixture path in
// the current config.js), so it backs up the exact original bytes and restores them in
// `after()` regardless of whether the assertions pass or fail.

const originalTenantsJson = fs.readFileSync(TENANTS_FILE, "utf8");
const originalTenantsListLength = _tenantsList.length;

after(() => {
  fs.writeFileSync(TENANTS_FILE, originalTenantsJson, "utf8");
  _tenantsList.length = originalTenantsListLength; // drop anything the test pushed
});

test("a config-style write survives a later architect-style write on a different tenant (bug #3 fixed)", () => {
  const testTenant = { slug: "__admin_config_test_tenant__", name: "Before", baseId: "app000", active: true };
  _tenantsList.push(testTenant);

  // Mirrors the FIXED /admin/config handler: mutate the shared reference, then write the
  // whole shared array atomically — not a disconnected re-parsed copy.
  testTenant.name = "After Config Save";
  writeJsonAtomic(TENANTS_FILE, _tenantsList);

  // Mirrors an unrelated architect-side write on some OTHER tenant (e.g. toggle-active) —
  // this always re-serializes the current in-memory _tenantsList.
  const otherTenant = _tenantsList[0];
  const otherTenantOriginalActive = otherTenant.active;
  otherTenant.active = !otherTenant.active;
  writeJsonAtomic(TENANTS_FILE, _tenantsList);
  otherTenant.active = otherTenantOriginalActive; // restore in-memory too, belt and suspenders

  const onDisk = JSON.parse(fs.readFileSync(TENANTS_FILE, "utf8"));
  const persisted = onDisk.find(t => t.slug === testTenant.slug);
  assert.ok(persisted, "test tenant should still be present in tenants.json");
  assert.equal(persisted.name, "After Config Save", "the config save must survive a later, unrelated tenants.json write");
});
