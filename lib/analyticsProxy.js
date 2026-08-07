import { Router, raw } from "express";

function plausibleScriptSrc() {
  return process.env.PLAUSIBLE_SCRIPT_SRC || "https://analytics.relascale.com/js/script.file-downloads.js";
}

const router = Router();

// Proxies Plausible's tracking script and event endpoint through this app's own
// origin. Without this, the script tag points straight at analytics.relascale.com,
// which ad blockers and tracking-protection lists (Firefox ETP, uBlock Origin, etc.)
// block outright by hostname alone — the "analytics." subdomain matches those lists
// regardless of what's actually running there. That surfaces in the browser console
// as a CORS failure with a null status code, which is misleading: the self-hosted
// Plausible instance itself is healthy, the browser just never sent the request.
// Serving the script same-origin also makes ad blockers unable to distinguish it from
// any other first-party asset.
router.get("/analytics/js", async (req, res) => {
  try {
    const upstream = await fetch(plausibleScriptSrc());
    if (!upstream.ok) return res.status(502).end();
    const body = await upstream.text();
    res.set("Content-Type", "application/javascript");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(body);
  } catch (err) {
    console.error("Analytics script proxy error:", err);
    res.status(502).end();
  }
});

// Plausible's script computes its own event endpoint as
// `new URL(scriptTag.src).origin + "/api/event"` unless a `data-api` attribute
// overrides it — views/partials/header.ejs sets data-api="/analytics/event" to send
// events here instead, same-origin, rather than reserving the generic top-level
// "/api" path. The body arrives as raw bytes (the script sends
// Content-Type: text/plain with a JSON string), so it's forwarded untouched rather
// than parsed and re-serialized.
router.post(
  "/analytics/event",
  raw({ type: "*/*", limit: "64kb" }),
  async (req, res) => {
    try {
      const origin = new URL(plausibleScriptSrc()).origin;
      const upstream = await fetch(`${origin}/api/event`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "User-Agent": req.headers["user-agent"] || "",
          "X-Forwarded-For": req.ip,
        },
        body: req.body,
      });
      const text = await upstream.text();
      res.status(upstream.status).send(text);
    } catch (err) {
      console.error("Analytics event proxy error:", err);
      res.status(502).end();
    }
  }
);

export default router;
