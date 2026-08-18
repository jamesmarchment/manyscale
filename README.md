# ManyScale

ManyScale is a self-hostable web app that makes self-report measures accessible to psychology researchers. It provides a searchable, browsable index of psychological scales sourced from Airtable, organized by construct, with translations paired to their originals.

The intended use is for subfield experts to run their own named instances — RelaScale for relationship science, AggreScale for aggression measures, PolitiScale for political psychology, and so on — contributing to a growing network of specialist collections.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js ≥ 18 (ES Modules) |
| Server | Express 5 |
| Templating | EJS |
| Data backend | Airtable (REST API, polled and cached locally) |
| Email | Nodemailer (SMTP) |
| Auth | express-session (admin panel) |
| File uploads | Multer |
| Frontend | Bootstrap 5, AOS, GLightbox, Swiper, Isotope, D3 |

---

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

See [Environment Variables](#environment-variables) below for details.

### 3. Configure tenants

Copy `tenants_example.json` to `tenants.json` and edit it:

```bash
cp tenants_example.json tenants.json
```

```json
[
  {
    "slug": "your-slug",
    "name": "Your Organization",
    "patEnvVar": "YOUR_AIRTABLE_PAT_ENV_VAR",
    "baseId": "yourAirtableBaseId",
    "contact_recipient": "you@example.com",
    "adminPasswordHash": "run `npm run hash-password` and paste the output here"
  }
]
```

- `slug` — used for cache directories, public asset paths, and URL routing
- `patEnvVar` — the name of the `.env` key that holds this tenant's Airtable PAT
- `baseId` — the Airtable base ID (starts with `app`)
- `contact_recipient` — where contact form and measure suggestion emails are delivered
- `adminPasswordHash` — password hash for this tenant's `/admin` panel, generated with `npm run hash-password`. Without it, `/admin/login` refuses to log anyone in. Resettable later from the Architect Admin Panel without needing the old password.
- `primaryTenant` *(optional)* — set to `true` on the tenant that should be treated as primary (served in single-tenant mode, refreshed on the startup/interval cycle — see [Caching and Data Sync](#caching-and-data-sync)). If no tenant has this set, the first entry in the list is used.
- `externalUrl` *(optional)* — for a tenant that's actually hosted on its own server (e.g. RelaScale) but kept here as a live tenant so it's included in cross-tenant search. The network landing page's repository card links here instead of `/{slug}`; `/{slug}` itself keeps working. Set from Architect Admin rather than editing this file directly.

### 4. Set up Airtable

Your Airtable base must have the following tables (exact names):

- **Measures** — each record is one measure; only records with `Status = "Approved"` are shown
- **Translations** — linked to Measures via `MeasureID (from MeasureID)`
- **Contributors** *(optional)* — records with a `Role` field set to `"Core Team"`, `"Contributor"`, `"Funding"`, or `"Scale Creator"`

Your Airtable Personal Access Token needs the following scopes:
- `data.records:read`
- `schema.bases:read` (required for table ID resolution at startup)
- `schema.bases:write` (only if you use the Architect Admin panel's automatic table scaffolding for a new tenant — not needed otherwise)

A form view on the Measures table is detected automatically and used as the submission link.

### 5. Run the server

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

The server starts on port `3007` by default, or whatever `PORT` is set to in `.env`. On startup (unless disabled — see `AIRTABLE_REFRESH_ON_STARTUP` below) it pulls all approved records from Airtable, downloads any PDFs not yet on disk, and writes the result to `cache/{slug}/cache.json`. This cycle repeats every `AIRTABLE_REFRESH_INTERVAL_HOURS` (default 6). If Airtable is unreachable, the server starts anyway and falls back to the local disk cache.

`npm start` runs the server in the foreground and exits when its terminal/session closes. For a persistent deployment, wrap it in a process manager of your choice (systemd, PM2, Docker, a NAS's built-in task scheduler, etc.) so it survives crashes, restarts on boot, and can be stopped/restarted cleanly.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `<patEnvVar>` | Yes | Airtable PAT for the primary tenant. The variable name comes from `patEnvVar` in `tenants.json` (e.g. `RELASCALE_PAT`) |
| `AIRTABLE_PAT_2` | No | PAT for an optional secondary Airtable base to merge into the primary cache |
| `BASE_ID_2` | No | Base ID for the secondary Airtable source |
| `AIRTABLE_REFRESH_ON_STARTUP` | No | Set to `"false"` to skip the immediate Airtable refresh when the server starts (default: refresh on startup). Editable from the Architect Admin Panel. |
| `AIRTABLE_REFRESH_INTERVAL_HOURS` | No | How often, in hours, to re-sync every active tenant from Airtable (default: `6`). Editable from the Architect Admin Panel. |
| `SITE_URL` | No | Canonical origin for the deployment (e.g. `https://manyscale.org`), used for absolute links in outbound email and for `<loc>`/`Sitemap:` entries in the generated sitemap and `robots.txt` — see [Sitemap & robots.txt](#sitemap--robotstxt). Blank until set. Editable from the Architect Admin Panel. |
| `SMTP_USER` | Yes* | Email address used to send contact and suggestion form emails |
| `SMTP_PASS` | Yes* | SMTP password for `SMTP_USER` |
| `SMTP_HOST` | No | SMTP host (default: `mail.manyscale.org`). Editable from the [Architect Admin Panel](#architect-admin-panel) — restart the server to apply. |
| `SMTP_PORT` | No | SMTP port (default: `465`). Editable from the Architect Admin Panel. |
| `SMTP_SECURE` | No | Set to `"false"` to disable TLS (default: `true`). Editable from the Architect Admin Panel. |
| `NETWORK_CONTACT_EMAIL` | No | Where the network landing page's "Request a Repo" form is delivered (falls back to `SMTP_USER`). Editable from the Architect Admin Panel. Multi-tenant mode only. |
| `PLAUSIBLE_DOMAIN` | No | Plausible Analytics `data-domain` (e.g. `manyscale.org`). Deployment-wide, not per-tenant. Blank disables analytics entirely. Editable from the Architect Admin Panel. |
| `PLAUSIBLE_SCRIPT_SRC` | No | Plausible script URL (default: `https://analytics.relascale.com/js/script.file-downloads.js`). Editable from the Architect Admin Panel. |
| `ADMIN_TOKEN` | No | Currently unused — the token-protected `GET /admin/refresh-cache`/`sync-pdfs` endpoints have been superseded by session-authenticated buttons in the `/admin` panel (kept commented out in `routes/admin.js` in case scripted access is wanted again) |
| `ARCHITECT_ADMIN_PASSWORD_HASH` | No | Password hash for the cross-tenant `/architect` panel — see [Architect Admin Panel](#architect-admin-panel) |
| `SESSION_SECRET` | Yes | Random string used to sign session cookies |
| `PORT` | No | Port to listen on (default: `3007`) |
| `MULTI_TENANT` | No | Set to `true` to enable slug-prefixed URLs (e.g. `/relationships/constructs`). Default is `false` (single-tenant, no slug in URL). |
| `TRUST_PROXY` | No | Set to `true` only if the app is running behind a reverse proxy (nginx, Caddy, Cloudflare, etc) that you control. Makes Express trust that proxy's `X-Forwarded-For`/`X-Forwarded-Proto` headers for rate limiting and cookie security. Leave unset (default `false`) for a direct-exposed deployment — trusting these headers without an actual proxy in front lets any client spoof its own IP and bypass IP-based rate limits. |

*Required if you want the contact or measure suggestion forms to send email.

---

## Routes

In **single-tenant** mode (`MULTI_TENANT=false`, the default) routes are served at the paths below. In **multi-tenant** mode (`MULTI_TENANT=true`) every tenant route is prefixed with `/{slug}` (e.g. `/relationships/constructs`), and `GET /` serves the network landing page instead (see below).

| Method | Path | Description |
|---|---|---|
| GET | `/` | Homepage (single-tenant) — or the network landing page (multi-tenant only) |
| GET | `/search?query=` | Search measures by name, construct, reference, description, or translation language |
| GET | `/constructs` | Browse all constructs alphabetically |
| GET | `/constructs/:name` | All measures tagged with a specific construct |
| GET | `/languages` | Browse all translation languages alphabetically |
| GET | `/languages/:name` | All measures with a translation into a specific language |
| GET | `/topics/:name` | All measures tagged with a specific topic (no index page) |
| GET | `/details/:id` | Individual measure detail page |
| GET | `/contributors` | Team and contributors listing |
| GET | `/terms` | Terms of service |
| GET | `/privacy` | Privacy policy |
| GET | `/sitemap.xml` | Generated sitemap (`/{slug}/sitemap.xml` in multi-tenant mode) — see [Sitemap & robots.txt](#sitemap--robotstxt) |
| GET | `/robots.txt` | Generated robots file, site-wide regardless of `MULTI_TENANT` |
| POST | `/contact` | Contact form submission |
| POST | `/suggest` | Measure suggestion form |
| POST | `/report-correction` | "Report a Correction" form on a measure detail page |
| GET | `/api/data` | Full JSON data dump; optional `?id=` filter |
| GET | `/api/search?q=` | JSON search endpoint (filters by construct) |
| GET | `/api/construct-stats` | JSON map of construct → measure count |
| GET | `/admin` | Admin panel (session-protected) |
| POST | `/admin/cache` | Trigger a cache refresh (session-protected, button in the admin panel) |
| POST | `/admin/sync-pdfs` | Trigger a PDF sync (session-protected, button in the admin panel) |
| GET/POST | `/admin/accept-terms` | Mandatory first-login Terms of Service acceptance for new tenant admins |
| GET/POST | `/admin/set-password` | Mandatory first-login password change for new tenant admins |
| GET | `/architect` | Architect admin dashboard listing all tenants (session-protected) |
| GET | `/architect/tenants/new` | New tenant onboarding form |
| POST | `/architect/tenants` | Provision a new tenant |

**Network-level routes** (multi-tenant only, unprefixed — see [Network Landing Page](#network-landing-page)):

| Method | Path | Description |
|---|---|---|
| GET | `/search?query=&lang=` | Search across every active tenant's cache at once, optionally filtered by translation language |
| GET | `/search/suggestions?query=` | JSON autocomplete suggestions, merged and deduped across tenants |
| POST | `/request-repo` | "Request a Repo" form submission — delivered to `NETWORK_CONTACT_EMAIL` |

---

## Admin Panel

Navigate to `/admin` and log in with the tenant's admin password (set via `adminPasswordHash` in `tenants.json`, or reset from the [Architect Admin Panel](#architect-admin-panel)). A newly-provisioned tenant admin's first login is gated: they must accept a placeholder Terms of Service (`/admin/accept-terms`, timestamped as `tosAcceptedAt` in `tenants.json`) and set their own password (`/admin/set-password`, replacing the temporary one from the onboarding email) before reaching the dashboard. Tenants that existed before this flow shipped are grandfathered in and never see it.

From the dashboard you can:

- Edit site content (hero heading, tagline, description, logo color)
- Write a custom markdown section shown on the homepage (headings, bold/italic, links, and lists — see [Custom Homepage Section](#custom-homepage-section)); leave it blank to hide the section entirely
- Edit Airtable connection settings (name, base ID, PAT, contact email)
- Manage the team section (add/edit members, upload photos)
- Manually trigger a cache refresh from Airtable

---

## Custom Homepage Section

Each tenant can add a free-text section to their homepage, written in markdown from the "Custom section" field on the `/admin` panel. It's stored as `whyMarkdown` in that tenant's `data/{slug}.json`, converted to HTML with `marked` and cleaned with `sanitize-html` on every request (`middleware.js`), then rendered into `views/index.ejs`. Supports headings, bold/italic, links, and bullet/numbered lists.

Leaving the field blank omits the section from the page entirely — no empty heading or leftover markup. There's no separate "enable/disable" toggle; the field's presence is the toggle.

---

## Architect Admin Panel

A separate, cross-tenant panel lives at `/architect`. It's always active regardless of `MULTI_TENANT` — unlike the per-tenant `/admin` panel, it isn't gated by that setting. Log in with the password matching `ARCHITECT_ADMIN_PASSWORD_HASH`, generated the same way as a tenant's `adminPasswordHash` (`npm run hash-password`), but pasted into `.env` instead of `tenants.json`.

From the dashboard you can:

- See every tenant's record count, last refresh time, and active/inactive status
- Onboard a new tenant — name, slug, contact email, Airtable base ID + PAT, and an admin password — with an option to scaffold the Measures/Translations/Contributors tables automatically in a fresh base
- Refresh a tenant's cache, deactivate/reactivate it, or delete it (deleting only removes the `tenants.json` entry; its cache and data files on disk are preserved)
- Reset a tenant's `/admin` password without needing the old one
- Edit a tenant's branding — logo (including SVG, sanitized on upload) and social-share meta image
- Set or clear a tenant's external link — for a tenant actually hosted on its own server, points the landing page's repository card at that URL instead of `/{slug}`, while `/{slug}` keeps working so the tenant still participates in cross-tenant search
- Edit platform-wide email settings (SMTP host/port/TLS, the network contact email the "Request a Repo" form delivers to, and the deployment's `SITE_URL`) used for contact-form, suggestion, tenant-onboarding mail, and sitemap/`robots.txt` generation across every tenant
- Edit platform-wide analytics settings (Plausible domain and script URL) used across every tenant
- Edit the Airtable refresh schedule (`AIRTABLE_REFRESH_ON_STARTUP`, `AIRTABLE_REFRESH_INTERVAL_HOURS`) — deployment-wide, applies on the next server restart

Provisioning a tenant primes its cache and, if requested, scaffolds its Airtable tables immediately — no restart needed. The one exception: a newly-created tenant isn't reachable on the public site until `MULTI_TENANT=true` is set in `.env` and the server is restarted, since single-tenant mode always serves the one configured primary tenant.

---

## Network Landing Page

In multi-tenant mode, `GET /` no longer just lists tenants — it's a network-wide hub, served by `routes/landing.js` + `views/landing.ejs`:

- A search bar that queries every active tenant's cache at once (`GET /search`, `lib/network.js`'s `searchNetwork()`), with autocomplete (`GET /search/suggestions`) merged and deduped across tenants
- A card for each active repository (name, accent color, tagline from that tenant's `data/{slug}.json` `landingTagline` — falling back to `meta.description` if unset — and measure count) linking to `/{slug}`, or to the tenant's `externalUrl` (set in `tenants.json` via Architect Admin) if it's hosted on its own server
- A list of every language with at least one translation somewhere in the network, each linking to `/search?lang=`
- A "Request a Repo" contact form (`POST /request-repo`), for visitors asking about or suggesting a new repository — delivered to `NETWORK_CONTACT_EMAIL`, not to any one tenant's `contact_recipient`

This page is intentionally its own thing rather than reusing tenant UI: it has its own nav, its own copy, and public-facing text always says "repository"/"repo", never "tenant" — that word is internal terminology and not how visitors think about the site. Deactivated tenants are excluded from the repo list, search, and language index.

Because `resolveTenant`/`tenantLocalsMiddleware` never run for these routes (there's no single "current tenant" on a network-wide page), `routes/landing.js` sets `res.locals.basePath = ""` and `res.locals.siteName = "ManyScale"` itself before rendering.

---

## Analytics (Plausible)

`views/partials/header.ejs` loads a Plausible Analytics script, configured from the
Architect Admin panel's "Analytics" section (or the `PLAUSIBLE_DOMAIN` /
`PLAUSIBLE_SCRIPT_SRC` env vars directly). This is deployment-wide, not per-tenant:
every tenant lives at a path under one shared domain (e.g. `manyscale.org/aggression`),
and Plausible attributes events by domain, not path — so there's one `data-domain` for
the whole deployment, the same way there's one SMTP configuration for the whole
deployment. Leaving `PLAUSIBLE_DOMAIN` blank disables analytics entirely; no script tag
is rendered.

---

## Sitemap & robots.txt

`lib/sitemap.js` generates an XML sitemap for each tenant and a single site-wide
`robots.txt`, built entirely from data already in memory — no extra Airtable calls of
their own. Both require `SITE_URL` to be set (see [Environment Variables](#environment-variables));
without it, generation is skipped and a warning is logged.

- **`sitemap.xml`** — written to `public/{slug}/sitemap.xml` (served at `/{slug}/sitemap.xml`)
  every time that tenant's cache refresh cycle runs (startup, the refresh interval, or a
  manual refresh from either admin panel) — see [Caching and Data Sync](#caching-and-data-sync).
  In single-tenant mode it's also mirrored to `public/sitemap.xml` at the root, where
  crawlers expect it. Includes the homepage, every measure detail page (`<lastmod>` from
  the record's Airtable `createdTime`), and the constructs/topics/languages/contributors/
  terms/privacy pages.
- **`robots.txt`** — written to `public/robots.txt` (served at `/robots.txt`) at server
  startup and whenever a tenant's active/external-link status changes in the Architect
  Admin panel, so it never depends on a refresh cycle. Lists a `Sitemap:` line per
  locally-served, active tenant (a tenant with `externalUrl` set is excluded — its
  content isn't hosted here), and disallows `/admin/` and `/architect/` so those
  session-gated panels stay out of search results.

---

## Project Structure

```
├── server.js                  # Entry point: wires middleware, mounts routers, starts server
├── config.js                  # Env/tenant bootstrap (dotenv, tenants.json, PAT, BASE_ID)
├── middleware.js              # Session, tenant locals, requireAdmin, rate limiter
├── tenants.json               # Tenant config (not committed)
├── tenants_example.json       # Template for tenants.json
├── .env                       # Secrets (not committed)
├── .env.example               # Template for .env
├── package.json
│
├── lib/
│   ├── airtable.js            # Cache, Airtable sync, PDF sync, startup refresh cycle
│   ├── email.js               # Nodemailer transporter
│   ├── emails/                # Templated emails: onboarding, password reset/changed
│   ├── search.js              # recordMatchesSearch(), stop-word set
│   ├── network.js             # Cross-tenant search/suggestions for the network landing page
│   ├── auth.js                # Password hashing/verification (scrypt) for admin/architect logins
│   ├── antispam.js            # Honeypot + timing-token + rate-limit guard for public forms
│   ├── csrf.js                # CSRF protection + the public-form exemption list
│   ├── jsonStore.js           # writeJsonAtomic() and other JSON-file helpers (tenants.json, data/{slug}.json)
│   ├── seo.js                 # Per-measure meta description/keywords for detail pages
│   ├── sitemap.js             # Sitemap.xml / robots.txt generation — see Sitemap & robots.txt
│   ├── colorPresets.js        # Shared palette presets for tenant-customizable colors
│   └── reservedSlugs.js       # RESERVED_SLUGS + startup assertion guarding tenant slugs from route collisions
│
├── routes/
│   ├── api.js                 # GET /api/data, /api/search, /api/construct-stats
│   ├── forms.js               # POST /contact, /suggest, /report-correction
│   ├── public.js              # All public page routes (/, /search, /constructs, /languages, etc.)
│   ├── admin.js               # All /admin/* routes and multer photo upload
│   ├── architect.js           # All /architect/* routes: tenant onboarding, branding, settings
│   └── landing.js             # GET / tenant index (multi-tenant mode only)
│
├── data/
│   └── {slug}.json            # Editable site content: hero, team, meta, logo color
│
├── cache/
│   └── {slug}/
│       ├── cache.json         # Current Airtable data cache (measures + translations)
│       └── cache-*.json       # Timestamped backups created on each refresh
│
├── views/
│   ├── index.ejs
│   ├── search.ejs
│   ├── details.ejs
│   ├── constructs.ejs
│   ├── construct-details.ejs
│   ├── languages.ejs
│   ├── language-details.ejs
│   ├── topic-details.ejs
│   ├── contributors.ejs
│   ├── terms.ejs
│   ├── privacy.ejs
│   ├── landing.ejs            # Network landing page (multi-tenant mode only; no partials)
│   ├── network-search.ejs     # Cross-tenant search results page (multi-tenant mode only)
│   ├── admin/
│   │   ├── index.ejs
│   │   ├── login.ejs
│   │   ├── forgot-password.ejs
│   │   ├── reset-password.ejs
│   │   ├── accept-terms.ejs   # Mandatory first-login Terms of Service acceptance
│   │   └── set-password.ejs   # Mandatory first-login password change
│   ├── architect/
│   │   ├── index.ejs          # Tenant dashboard
│   │   ├── login.ejs
│   │   ├── tenant-form.ejs    # New tenant onboarding form
│   │   ├── tenant-created.ejs
│   │   └── tenant-branding.ejs
│   └── partials/
│       ├── header.ejs
│       ├── nav.ejs
│       ├── footer.ejs
│       └── network-footer.ejs
│
└── public/
    ├── assets/
    │   ├── css/               # Site stylesheets
    │   ├── js/                # Site scripts
    │   ├── img/               # Images
    │   └── vendor/            # Bootstrap, AOS, GLightbox, Swiper, Isotope, D3
    ├── robots.txt             # Generated — see Sitemap & robots.txt (gitignored)
    ├── sitemap.xml            # Generated, single-tenant mode only (gitignored)
    └── {slug}/
        ├── pdfs/              # Locally cached measure PDFs (downloaded from Airtable)
        ├── team/              # Team photos (uploaded via admin panel)
        ├── cache-stats.json   # Public stats: measure count, construct count, item count
        └── sitemap.xml        # Generated per tenant (gitignored) — see Sitemap & robots.txt
```

---

## Caching and Data Sync

The server resolves Airtable table IDs (unless `AIRTABLE_REFRESH_ON_STARTUP=false`, see [Environment Variables](#environment-variables)) at startup via the metadata API, then pulls all approved measures and translations, downloads any new PDFs, and writes `cache/{slug}/cache.json`. A timestamped backup is created alongside it only when the data has changed since the previous refresh. This cycle repeats every `AIRTABLE_REFRESH_INTERVAL_HOURS` (default 6).

If Airtable is unreachable, the server starts and serves from the existing disk cache. It keeps retrying on each scheduled cycle and recovers automatically. A manual refresh (from either admin panel) resolves table IDs itself if they haven't been resolved yet — e.g. right after a restart with `AIRTABLE_REFRESH_ON_STARTUP=false` — so it works even before the first scheduled cycle has run.

Manual refresh is triggered from a browser session rather than a scripted token endpoint: the "Refresh cache" / "Sync PDFs" buttons in the `/admin` panel refresh that one tenant (`POST /admin/cache`, `POST /admin/sync-pdfs`), and the Architect Admin panel can refresh any tenant's cache the same way (`POST /architect/tenants/:slug/refresh-cache`).

---

## Secondary Airtable Source

A tenant can optionally pull from a second Airtable base and merge its records into the primary cache. Configure it per-tenant in `tenants.json`:

```json
{
  "slug": "your-slug",
  "patEnvVar": "YOUR_PAT",
  "baseId": "appXXXXXXXXXX",
  "secondaryPatEnvVar": "YOUR_SECONDARY_PAT",
  "secondaryBaseId": "appYYYYYYYYYY"
}
```

Then add the PAT value itself to `.env` under whatever key name you chose for `secondaryPatEnvVar`. Tenants that omit `secondaryPatEnvVar` / `secondaryBaseId` never attempt a secondary fetch.

Records with the same `MeasureID` as a primary record are skipped; deduplication events are logged to `server.log` with a field-level diff. This is intended for federating multiple contributing collections into one instance.
