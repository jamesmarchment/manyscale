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
    "contact_recipient": "you@example.com"
  }
]
```

- `slug` — used for cache directories, public asset paths, and URL routing
- `patEnvVar` — the name of the `.env` key that holds this tenant's Airtable PAT
- `baseId` — the Airtable base ID (starts with `app`)
- `contact_recipient` — where contact form and measure suggestion emails are delivered
- `primaryTenant` *(optional)* — set to `true` on the tenant that should be treated as primary (served in single-tenant mode, refreshed on the startup/6-hour cycle). If no tenant has this set, the first entry in the list is used.

### 4. Set up Airtable

Your Airtable base must have the following tables (exact names):

- **Measures** — each record is one measure; only records with `Status = "Approved"` are shown
- **Translations** — linked to Measures via `MeasureID (from MeasureID)`
- **Contributors** *(optional)* — records with a `Role` field set to `"Core Team"`, `"Contributor"`, or `"Funding"`

Your Airtable Personal Access Token needs the following scopes:
- `data.records:read`
- `schema.bases:read` (required for table ID resolution at startup)

A form view on the Measures table is detected automatically and used as the submission link.

### 5. Run the server

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

The server starts on port `3007` by default, or whatever `PORT` is set to in `.env`. On startup it pulls all approved records from Airtable, downloads any PDFs not yet on disk, and writes the result to `cache/{slug}/cache.json`. This cycle repeats every 6 hours. If Airtable is unreachable, the server starts anyway and falls back to the local disk cache.

`npm start` runs the server in the foreground and exits when its terminal/session closes. For a persistent deployment, wrap it in a process manager of your choice (systemd, PM2, Docker, a NAS's built-in task scheduler, etc.) so it survives crashes, restarts on boot, and can be stopped/restarted cleanly.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `<patEnvVar>` | Yes | Airtable PAT for the primary tenant. The variable name comes from `patEnvVar` in `tenants.json` (e.g. `RELASCALE_PAT`) |
| `AIRTABLE_PAT_2` | No | PAT for an optional secondary Airtable base to merge into the primary cache |
| `BASE_ID_2` | No | Base ID for the secondary Airtable source |
| `SMTP_USER` | Yes* | Email address used to send contact and suggestion form emails |
| `SMTP_PASS` | Yes* | SMTP password for `SMTP_USER` |
| `SMTP_HOST` | No | SMTP host (default: `mail.manyscale.org`). Editable from the [Architect Admin Panel](#architect-admin-panel) — restart the server to apply. |
| `SMTP_PORT` | No | SMTP port (default: `465`). Editable from the Architect Admin Panel. |
| `SMTP_SECURE` | No | Set to `"false"` to disable TLS (default: `true`). Editable from the Architect Admin Panel. |
| `NETWORK_CONTACT_EMAIL` | No | Where the network landing page's "Request a Repo" form is delivered (falls back to `SMTP_USER`). Editable from the Architect Admin Panel. Multi-tenant mode only. |
| `ADMIN_PASSWORD` | Yes | Password for the `/admin` panel |
| `ADMIN_TOKEN` | No | Token for scripted cache and PDF sync endpoints |
| `ARCHITECT_ADMIN_PASSWORD_HASH` | No | Password hash for the cross-tenant `/architect` panel — see [Architect Admin Panel](#architect-admin-panel) |
| `SESSION_SECRET` | Yes | Random string used to sign session cookies |
| `PORT` | No | Port to listen on (default: `3007`) |
| `MULTI_TENANT` | No | Set to `true` to enable slug-prefixed URLs (e.g. `/relationships/constructs`). Default is `false` (single-tenant, no slug in URL). |

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
| GET | `/details/:id` | Individual measure detail page |
| GET | `/contributors` | Team and contributors listing |
| GET | `/terms` | Terms of service |
| GET | `/privacy` | Privacy policy |
| POST | `/contact` | Contact form submission |
| POST | `/suggest` | Measure suggestion form |
| GET | `/api/data` | Full JSON data dump; optional `?id=` filter |
| GET | `/api/search?q=` | JSON search endpoint (filters by construct) |
| GET | `/api/construct-stats` | JSON map of construct → measure count |
| GET | `/admin` | Admin panel (session-protected) |
| GET | `/admin/refresh-cache?token=` | Trigger a cache refresh (token-protected) |
| GET | `/admin/sync-pdfs?token=` | Trigger a PDF sync (token-protected) |
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

Navigate to `/admin` and log in with `ADMIN_PASSWORD`. From there you can:

- Edit site content (hero heading, tagline, description, logo color)
- Edit Airtable connection settings (name, base ID, PAT, contact email)
- Manage the team section (add/edit members, upload photos)
- Manually trigger a cache refresh from Airtable

---

## Architect Admin Panel

A separate, cross-tenant panel lives at `/architect`. It's always active regardless of `MULTI_TENANT` — unlike the per-tenant `/admin` panel, it isn't gated by that setting. Log in with the password matching `ARCHITECT_ADMIN_PASSWORD_HASH`, generated the same way as a tenant's `adminPasswordHash` (`npm run hash-password`), but pasted into `.env` instead of `tenants.json`.

From the dashboard you can:

- See every tenant's record count, last refresh time, and active/inactive status
- Onboard a new tenant — name, slug, contact email, Airtable base ID + PAT, and an admin password — with an option to scaffold the Measures/Translations/Contributors tables automatically in a fresh base
- Refresh a tenant's cache, deactivate/reactivate it, or delete it (deleting only removes the `tenants.json` entry; its cache and data files on disk are preserved)
- Edit platform-wide email settings (SMTP host/port/TLS, and the network contact email the "Request a Repo" form delivers to) used for contact-form, suggestion, and tenant-onboarding mail across every tenant

Provisioning a tenant primes its cache and, if requested, scaffolds its Airtable tables immediately — no restart needed. The one exception: a newly-created tenant isn't reachable on the public site until `MULTI_TENANT=true` is set in `.env` and the server is restarted, since single-tenant mode always serves the one configured primary tenant.

---

## Network Landing Page

In multi-tenant mode, `GET /` no longer just lists tenants — it's a network-wide hub, served by `routes/landing.js` + `views/landing.ejs`:

- A search bar that queries every active tenant's cache at once (`GET /search`, `lib/network.js`'s `searchNetwork()`), with autocomplete (`GET /search/suggestions`) merged and deduped across tenants
- A card for each active repository (name, accent color, description from that tenant's `data/{slug}.json` `meta.description`, and measure count) linking to `/{slug}`
- A list of every language with at least one translation somewhere in the network, each linking to `/search?lang=`
- A "Request a Repo" contact form (`POST /request-repo`), for visitors asking about or suggesting a new repository — delivered to `NETWORK_CONTACT_EMAIL`, not to any one tenant's `contact_recipient`

This page is intentionally its own thing rather than reusing tenant UI: it has its own nav, its own copy, and public-facing text always says "repository"/"repo", never "tenant" — that word is internal terminology and not how visitors think about the site. Deactivated tenants are excluded from the repo list, search, and language index.

Because `resolveTenant`/`tenantLocalsMiddleware` never run for these routes (there's no single "current tenant" on a network-wide page), `routes/landing.js` sets `res.locals.basePath = ""` and `res.locals.siteName = "ManyScale"` itself before rendering.

---

## Analytics (Plausible) — currently unused

`views/partials/header.ejs` loads a Plausible Analytics script on every page, but it's
not functional as shipped: the `data-domain` attribute is set to the tenant's display
name (e.g. `"AggreScale"`) rather than the site's actual registered domain, which is
what Plausible requires to attribute events. As a result no analytics are currently
being recorded on any tenant.

This needs to be fixed before relying on it — either by deriving `data-domain` from the
request host (`req.get("host")` / `locals.siteOrigin`) at render time, or by making the
Plausible domain (and script src, currently hardcoded to `analytics.relascale.com`)
configurable per-tenant or platform-wide from the Architect Admin panel, the same way
email settings are handled.

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
│   └── search.js              # recordMatchesSearch(), stop-word set
│
├── routes/
│   ├── api.js                 # GET /api/data, /api/search, /api/construct-stats
│   ├── forms.js               # POST /contact, POST /suggest
│   ├── public.js              # All public page routes (/, /search, /constructs, etc.)
│   ├── admin.js               # All /admin/* routes and multer photo upload
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
│   ├── contributors.ejs
│   ├── terms.ejs
│   ├── privacy.ejs
│   ├── landing.ejs            # Tenant index page (multi-tenant mode only; no partials)
│   ├── admin/
│   │   ├── index.ejs
│   │   └── login.ejs
│   └── partials/
│       ├── header.ejs
│       ├── nav.ejs
│       └── footer.ejs
│
└── public/
    ├── assets/
    │   ├── css/               # Site stylesheets
    │   ├── js/                # Site scripts
    │   ├── img/               # Images
    │   └── vendor/            # Bootstrap, AOS, GLightbox, Swiper, Isotope, D3
    └── {slug}/
        ├── pdfs/              # Locally cached measure PDFs (downloaded from Airtable)
        ├── team/              # Team photos (uploaded via admin panel)
        └── cache-stats.json   # Public stats: measure count, construct count, item count
```

---

## Caching and Data Sync

The server resolves Airtable table IDs at startup via the metadata API, then pulls all approved measures and translations, downloads any new PDFs, and writes `cache/{slug}/cache.json`. A timestamped backup is created alongside it only when the data has changed since the previous refresh. This cycle repeats every 6 hours.

If Airtable is unreachable, the server starts and serves from the existing disk cache. It keeps retrying on each scheduled cycle and recovers automatically.

For scripted environments, manual refresh endpoints are available without a browser session:

```
GET /admin/refresh-cache?token=<ADMIN_TOKEN>
GET /admin/sync-pdfs?token=<ADMIN_TOKEN>
```

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
