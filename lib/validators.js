// lib/validators.js
// Full absolute-URL check (http/https only) — for config values that must always be a
// complete external URL, as opposed to routes/architect.js's isSafeBrandingUrl, which
// also allows a relative path (that one's for upload paths like logoUrl/metaImageUrl;
// this one's for values like PLAUSIBLE_SCRIPT_SRC that are never relative).
export function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}
