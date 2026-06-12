# Ranch Enterprises Unified System — Master Scaffold

**Codename:** REX (Ranch Enterprises eXchange)
**Owner:** Hayden Oehler, Real Estate Operations and Innovations Manager
**Status:** Draft v0.2 — June 2026
**Doc control:** This file lives in a Git repo. Every revision is a commit. Commit history doubles as the weekly deliverable log.
**End goal (from leadership):** A buyer can find, tour, finance, and close on a property 100% from their phone, in an expedited timeline, with zero required human intervention.

---

## 1. Executive Summary

Ranch Enterprises currently runs ~40 entities on a patchwork of RealStack (websites), The Mortgage Office (loan servicing), Airtable (now mirrored to Supabase), Excel, and a physical pink card that gets passed around the office to close a deal. REX replaces the patchwork with one platform on a single source of truth: the Supabase database already migrated from Airtable (7,938 properties, 273 ranches, 63 companies, 5,226+ owner finance loan records).

One backend. Many faces:

- Public brand websites (Triad, Ranch King, Kerr Land Co, etc.) all reading the same inventory
- Internal app: CRM, lead routing, deal tracker (digital pink card), loan dashboard, messaging, management views
- AI layer: 1-click property descriptions (human approved), buyer-facing property search chatbot, listing syndication
- Payment portal and eventually full e-closing

Two operating principles govern the build:

1. **Ship ugly and useful before pretty and theoretical.** This is a 1 person build running alongside Lohn Hollow marketing and other duties. Every phase has a stripped MVP definition and a polish backlog.
2. **Adoption is the product.** A system the office does not use is a failure regardless of code quality. Change management is a first-class workstream, not an afterthought.

---

## 2. Current State (what we are replacing or integrating)

| System | Function today | REX disposition |
|---|---|---|
| Airtable | Property/ranch/loan database | **Replaced** — already mirrored into Supabase |
| RealStack (app.realstack.com) | Triad website + listings | **Replaced** by REX public sites, with a full SEO redirect migration (see §5.1 and §7) |
| The Mortgage Office (TMO) | Loan servicing, payments, escrow | **Integrate first, replace maybe never** — see §7 |
| Pink card (physical) | Deal closing checklist | **Replaced** by digital deal pipeline after a 30 day parallel run (see §6) |
| Excel sheets | Everything else | **Replaced** incrementally |
| Facebook lead forms, phone calls | Lead intake | **Integrated** into CRM lead router with dedup (Phase 2) |
| Manual posting | Social media + listing portals | **Replaced** by syndication engine (Phase 5) |

### Brand sites to consolidate onto REX

All run on the same Supabase inventory, each with its own domain, theme, and assigned property set:

1. ranchenterprisesltd.com (parent)
2. triadranches.com
3. ranches-tx.com
4. txranchlandsales.com
5. ranchkingsales.com
6. herchmanrealty.com
7. texaslandandlivestock.com
8. txhuntingproperties.com
9. diamondbackproperties.net
10. kerrlandco.com
11. hillcountryusa.com
12. 4-tranch.com
13. Per-project funnel sites (one micro site per ranch acquisition, e.g. Lohn Hollow)

---

## 3. Architecture Overview

```
                        ┌─────────────────────────────┐
                        │   SUPABASE (single source    │
                        │   of truth)                  │
                        │   Postgres + Auth + Storage  │
                        │   + Realtime + Edge Functions│
                        └──────────┬──────────────────┘
                                   │
        ┌──────────────┬───────────┼───────────────┬───────────────┐
        │              │           │               │               │
 ┌──────▼──────┐ ┌─────▼─────┐ ┌──▼─────────┐ ┌───▼──────────┐ ┌──▼─────────┐
 │ Public sites │ │ Internal  │ │ AI services │ │ Integrations │ │ Buyer      │
 │ (multi-brand │ │ app (CRM, │ │ (descriptions│ │ (TMO, FB,   │ │ portal     │
 │ Next.js,     │ │ deals,    │ │ chatbot,    │ │ Land.com,   │ │ (account,  │
 │ per-domain   │ │ loans,    │ │ lead scoring│ │ socials,    │ │ payments,  │
 │ theming)     │ │ messaging)│ │ media)      │ │ ACH, RON)   │ │ e-closing) │
 └──────────────┘ └───────────┘ └─────────────┘ └──────────────┘ └────────────┘
```

### Stack decisions

| Layer | Choice | Why |
|---|---|---|
| Database | Supabase Postgres | Already migrated. Row level security per company/role. Realtime for live dashboards. |
| Environments | **2 Supabase projects: production + staging, from day 1.** Staging seeded with scrubbed test data. Never develop or test against production loan records. | Office-critical system. No cowboy pushes. |
| Frontend | Next.js 15 (App Router) on Vercel | Already the stack for Cedar Hack. One monorepo, many domains via multi-tenant routing. Vercel preview deploys point at staging. |
| Monorepo | Turborepo: `apps/web-public`, `apps/web-internal`, `packages/db`, `packages/ui`, `packages/ai` | Shared components, shared types generated from Supabase schema. |
| Maps | Mapbox GL JS (Satellite Streets v12) + parcel overlays | Already proven on Cedar Hack. NAIP/Esri overlays available. |
| AI | Anthropic API (Claude) via Edge Functions | Descriptions, chatbot, lead summarization, social copy, Spanish translation. |
| Auth | Supabase Auth | Staff roles internal, buyer accounts public. |
| Payments | ACH provider (Dwolla / Stripe ACH / Moov) feeding TMO | See §7 landmines. |
| File storage | Supabase Storage + Cloudflare R2 for drone imagery tiles | Orthomosaics are big. R2 has no egress fees. |
| Backups / disaster recovery | Supabase point-in-time recovery enabled + nightly `pg_dump` to R2 with 90 day retention + quarterly restore drill | 5,226 loan records is not something you explain losing. |
| Drone pipeline | RealityScan / WebODM → GeoTIFF → tiles → Mapbox raster overlay | RealityScan already running on the 3060. |

### Multi-tenancy model

- `companies` table (63 records) already exists. Add `brands` table mapping domain → company set → theme.
- One Next.js app serves all public domains. Middleware reads `Host` header, loads brand config, filters inventory.
- Single deploy updates every site. Per-ranch funnel sites are just brand records with 1 ranch assigned.

---

## 4. Data Model (extends existing Supabase schema)

Existing core (from Airtable migration): `properties`, `ranches`, `companies`, `loans` (TMO mirror), `prev_cust` junction, `pay_req` junction.

New tables to add:

```
-- Foundation (Phase 0 — non-negotiable, built before any feature)
audit_log           (table, record_id, user_id, action, diff_json, ts)
                    -- generic trigger on every business table from day 1.
                    -- Retrofitting audit trails is miserable; with 40 entities
                    -- and owner finance loans, every change is logged from the start.

-- Public/web
brands              (id, domain, name, company_ids[], theme_json, logo_url, ga_id)
listings            (id, property_id, brand_id, status, price, headline,
                     ai_description, description_es, seo_slug,
                     approved_by, approved_at, published_at, last_verified_at)
media               (id, listing_id, type [photo|video|drone_ortho|doc],
                     storage_path, sort_order, caption)
parcel_geometries   (property_id, geojson, source [survey|cad|drawn], acres_calc)
redirects           (old_url, new_url, brand_id, status_code, hit_count)
                    -- the 301 map for the RealStack migration lives in the DB,
                    -- served by Next.js middleware, hit counts prove coverage.

-- CRM
contacts            (id, normalized_phone, normalized_email, name, ...)
                    -- dedup spine. Unique indexes on normalized phone + email.
leads               (id, contact_id, source [web|fb|call|portal|chatbot],
                     property_id, brand_id, message, score, status, created_at)
                    -- intake function matches/creates contact BEFORE creating
                    -- the lead. Same buyer from website + FB + phone = 1 contact,
                    -- 3 lead events, 1 salesman. No triple-calling, no commission fights.
lead_assignments    (lead_id, salesman_id, assigned_at, accepted_at, method
                     [round_robin|first_claim|manual])
activities          (id, contact_id, type [call|text|email|note|showing], body,
                     user_id, created_at, synced_at)
                    -- synced_at supports offline queue (see §5.2).

-- Deals (digital pink card)
deals               (id, property_id, buyer_contact_id, salesman_id, stage,
                     price, terms_json, created_at)
deal_checklist_items(deal_id, step_key, label, required_role, status,
                     completed_by, completed_at, doc_path)
checklist_templates (template_id, step_key, label, order, required_role)

-- Ops
users               (Supabase auth) + profiles (role, company_ids[], phone)
messages            (id, channel_id, user_id, body, created_at)
tasks               (id, assignee_id, deal_id?, due, status)

-- Marketing
syndication_jobs    (listing_id, channel [land.com|fb|ig|x|yt|tiktok|truth|li],
                     status, external_id, posted_at, error)
campaigns           (id, ranch_id, budget, channel, utm, results_json)

-- Payments / closing
buyer_accounts      (contact_id, auth_user_id, kyc_status)
payment_methods     (buyer_id, ach_token, verified)
transactions        (loan_id?, deal_id?, amount, type [down|monthly|fee],
                     processor_ref, status, tmo_synced)
```

**Rule: Supabase is the single source of truth for everything except live loan balances, which TMO owns until/unless it is replaced.** REX reads TMO; TMO does not read REX (except payment postings).

---

## 5. Module Specs

### 5.1 Public Websites (replaces RealStack)

- Match what works on triadranches.com (search by county/acreage/price, listing pages) but modern: fast, mobile first, map driven.
- **Map UX:** Full screen Mapbox map. Parcel polygons clickable → property card → full listing page. Cluster pins at low zoom. Filters: county, acres, price, water well, electric, owner finance available, hunting.
- **Listing page:** Photo/video gallery, drone orthomosaic viewer with parcel boundary overlay, approved description, terms calculator (down payment + monthly at Ranch Enterprises Loan Servicing rates), inquiry form, "Buy Now" CTA (Phase 7).
- **Spanish listings:** every listing gets a `description_es` generated in the same AI call and a language toggle. Material share of Texas land buyers, near zero marginal cost, conversion edge the competitors listed in §2 ignore.
- **Per-ranch funnel sites:** Auto generated from a ranch record. Landing page, lot map, lead capture, FB pixel. Spin one up in under 10 minutes when a new ranch is acquired.
- SEO: server rendered, schema.org RealEstateListing markup, per-county landing pages (this is where RealStack sites win their traffic).

**SEO migration protocol (mandatory per brand cutover):**

1. Crawl the live RealStack site (Screaming Frog) and export every indexed URL.
2. Build a 1:1 301 redirect map in the `redirects` table. Every old listing, county page, and search page maps to its new equivalent. No blanket redirects to the homepage.
3. Cut DNS, submit new sitemap to Google Search Console, monitor redirect hit counts and Search Console coverage for 60 days.
4. **Do not cancel RealStack for a brand until its redirect map is verified live.** Skipping this drops organic lead flow 50%+ for months and hands the boss a reason to distrust the whole project.

### 5.2 CRM + Lead Routing

- **Intake channels:** website forms, FB Lead Ads (webhook), phone (Twilio number per brand, call → lead record + voicemail transcription), chatbot conversations, portal signups.
- **Dedup at the front door:** every intake passes through 1 function that normalizes phone (E.164) and email, matches against `contacts` (including the 5,226+ previous customer records), and attaches the lead to the existing contact. New lead event on an already-assigned contact routes to the existing salesman, not the round robin.
- **Routing:** configurable per brand. Default: round robin among on-duty salesmen with a claim window (push notification, 5 min to accept, then next man up). "First available on inbound call" = Twilio simultaneous ring or queue.
- **Lead record shows:** source, property of interest, full prior history, AI summary of all interactions.
- **Salesman mobile view, offline tolerant:** half these ranches have no signal. Listings, contacts, and the salesman's active leads are cached locally (PWA + service worker, or local-first sync like a queued mutations table). Activity logging (notes, voice memos, showing check-ins) queues offline and syncs when signal returns via `synced_at`. If the field app dies without bars, it dies where deals actually happen, so this is a launch requirement, not polish.

### 5.3 Deal Tracker — Digital Pink Card

This is the highest internal ROI item and the cultural keystone. The pink card already encodes the company's closing process; digitize it 1:1 first, improve later.

- `checklist_templates` per deal type (cash sale, owner finance, TMO loan setup, etc. — matching the 4 loan type values in the schema).
- Each step has a required role (sales, title/closing, accounting, management). Step completion is gated by role; completing a step notifies the next role. Realtime board view = the pink card on a TV in the office.
- Nothing funds or records until all required steps are green. The Phase 0 audit log captures every checkbox. That is the court discovery protection and the training tool.
- **Action item before building: photograph/scan an actual pink card and enumerate every line on it.** The template IS the spec.
- Rollout follows the parallel-run protocol in §6.

### 5.4 Loan Dashboard + TMO Integration (see §7)

- Read-only mirror of TMO portfolios into Supabase on a sync schedule (TMO has an API/SDK; licensing and access level needs confirmation with their rep).
- Views: delinquency aging, payoff quotes, per-company portfolio rollups, borrower lookup tied to CRM contact.
- Payment portal posts ACH payments and writes them back to TMO (their borrower web portal add-on may shortcut rungs 1–2 in §5.9).

### 5.5 AI Layer

- **1-click descriptions with hard guardrails:** Edge Function takes property record + tagged media + ranch context → generates listing copy in brand voice plus Spanish version plus short-form variants (FB post, IG caption, Land.com summary) in 1 call.
  - **Guardrail 1: structured fields only.** The model may only describe amenities present as structured data on the record (well = true, electric = true, road frontage value, etc.). It never infers or invents features from photos or vibes. An AI description claiming a water well that does not exist is a Texas DTPA (Deceptive Trade Practices Act) claim with treble damages, multiplied across 7,938 properties if the prompt is wrong once.
  - **Guardrail 2: human approval gate.** No description publishes without a named approver. `approved_by` and `approved_at` on the listing record, captured in the audit log. Edits after approval reset the gate.
- **Buyer chatbot:** Claude with tool access to a `search_properties` function over Supabase ("something in Edwards County with a water well, 10 to 20 acres" → structured query → cards with map links). Capture contact info naturally mid-conversation → contact + lead via the dedup intake function. Chatbot answers only from structured data, same anti-fabrication rule as descriptions.
- **Internal copilot (later):** "show me all delinquent loans on Lohn Hollow," "draft a follow up text to everyone who toured last weekend."
- Lead scoring, photo auto-tagging (well, pond, barn, road — tags feed the structured fields, which feed descriptions), call transcription summaries.

### 5.6 Syndication Engine

Two very different problems. Do not treat them as one feature:

| Channel | Method | Reality check |
|---|---|---|
| Land.com network (Lands of Texas, LandWatch, Land And Farm) | Bulk feed / API with paid membership | Straightforward. They want your inventory. |
| Facebook, Instagram | Meta Graph API | Doable, official API. |
| YouTube | Data API | Doable. |
| TikTok | Content Posting API | Doable, requires app approval. |
| X (Twitter) | API (paid tier) | Doable, costs money. |
| Truth Social, LinkedIn | LinkedIn API is fine; Truth has no real public posting API | Truth = manual or browser automation. Consider a self-hosted Postiz/Mixpost instance instead of building all 8 integrations yourself. |
| Zillow / Trulia / Realtor.com | **MLS feed only** for most listing types | **Landmine:** these portals ingest from MLS via licensed brokers. You cannot just push a feed. If Herchman Realty (or whichever entity holds the broker license) is in an MLS, listings flow there automatically. Otherwise this channel is largely closed to direct integration. Land.com network matters far more for rural acreage anyway. |

Recommendation: build Land.com feed + Meta API in house (highest value), buy/self-host a social scheduler for the rest, route MLS-eligible listings through the licensed broker entity.

### 5.7 Drone Mapping Pipeline

- Workflow: fly mission (mapping app with overlap settings) → photos → WebODM or RealityScan → georeferenced orthomosaic GeoTIFF → `gdal2tiles`/titiler → raster tiles in R2 → Mapbox overlay layer per ranch.
- Overlay parcel boundary GeoJSON (from survey CAD or county CAD data, hand corrected) on top. Click polygon → listing page.
- Tag improvements as vector point/line layers: wells, tanks, roads, fences, electric, blinds. These double as the structured inputs the AI description guardrails require.
- **Landmine:** commercial drone ops require FAA Part 107 certification for the pilot. Cheap test (~$175), get it before flying for the company.

### 5.8 Internal Ops

- Messaging: do not build a chat app. Either Supabase Realtime channels embedded as a simple deal-scoped comment thread (do this) plus keep texting/Slack for general chat, or full Slack integration. Building Slack is a tar pit.
- Management views: lead response times, deals by stage, salesman scoreboard, listing freshness, marketing spend vs closings per ranch.
- Employee admin (PTO, writeups, docs): low priority, use existing HR tools until Phase 7+.

### 5.9 Buyer Portal + Payment + E-Closing (the "100% on your phone" goal)

Progressive ladder, each rung shippable alone:

1. **Reserve online:** pick a lot, sign reservation, pay refundable deposit by ACH/card. Humans finish the deal. (Big win, low risk.)
2. **Borrower portal:** existing TMO borrowers see balance, make payments, download statements.
3. **Digital contracting:** contract for deed / note + deed of trust packages generated from deal record, e-signed (DocuSign/Documenso).
4. **Remote online notarization (RON):** legal in Texas since 2018. Deed of trust notarized by webcam.
5. **Full self-serve close:** identity verification (KYC), automated title/lien check posture, payment, recording packet to county. Human review becomes a 5 minute approval click instead of a 2 week relay race.

---

## 6. Adoption & Change Management

The pink card works because everyone trusts it. REX earns that trust deliberately or not at all.

- **Pilot, then expand.** Pick 1 salesman (highest volume or most tech-friendly) as the CRM pilot for 30 days before office-wide rollout. Fix what he hates. He becomes the internal evangelist.
- **Parallel run on the pink card.** Paper and digital run side by side for 30 days minimum. Office staff fill both. Digital retires the paper only when 3 consecutive deals close with zero discrepancies between the two. Killing the paper card on day 1 is how the project dies in week 2.
- **The TV board.** Mount the realtime deal board in the office. Gene and the principals see the pipeline without logging into anything. Passive visibility builds executive confidence faster than any demo.
- **1-page cheat sheets, not manuals.** Each role gets a single laminated page: here is your screen, here are your 4 buttons.
- **Office hours.** A standing 30 minutes weekly where anyone brings complaints. Every complaint gets logged as a ticket and visibly fixed or visibly declined with a reason.
- **Never break their old way without a working new way.** RealStack stays up per brand until redirects are verified (§5.1). TMO stays the loan system of record indefinitely.

---

## 7. Data Governance

7,938 properties with prices, statuses, and photos go stale fast, and stale inventory on a public website is both embarrassing and a misrepresentation risk.

| Domain | Owner (role) | Write rights | Freshness SLA |
|---|---|---|---|
| Property facts (acres, amenities, geometry) | Operations (Hayden initially) | Ops role only | Verified at listing creation + any improvement change |
| Listing status + price | Sales manager | Sales manager + closing role | Status updated within 24 hrs of contract/close; auto-flip on deal stage change |
| Descriptions | Marketing | AI draft → named approver | Re-approval on any fact change |
| Loan data | TMO (system of record) | Nobody writes in REX | Sync schedule per TMO integration |
| Leads/contacts | Salesmen (own records) | Assigned salesman + manager | Response SLA: first contact within 1 hr business hours |

- **Auto-flip rule:** when a deal hits "closed" the listing flips to sold automatically. No human remembers to take it down because no human has to.
- **Staleness report:** weekly automated list of listings past `last_verified_at` threshold (90 days) goes to the sales manager.
- Row level security in Supabase enforces the write rights column, not office policy.

---

## 8. Phased Roadmap

Each phase has an MVP (ship this) and Polish (backlog). Kill criteria pre-decide the fallback so a blocked dependency reads as a planned pivot, not a failure.

| Phase | MVP scope | Polish backlog | Duration | Kill criteria / fallback |
|---|---|---|---|---|
| 0 | Schema extensions, **audit log triggers**, staging + prod environments, backups, monorepo, brand config, auth/roles | — | 2–3 wks | None. Foundation is unconditional. |
| 1 | **Lohn Hollow funnel site, stripped:** listings, static lot map image or simple GeoJSON polygons, manually written descriptions, lead capture form, FB pixel | Interactive Mapbox parcel UX, AI descriptions, drone overlay, Spanish toggle | 2–3 wks MVP | If Mapbox parcel work stalls past 1 wk, ship with a static map. Leads now beat pretty later. |
| 2 | CRM: dedup intake, FB + web + Twilio channels, round robin routing, pilot salesman mobile view with offline queue | Voice-note transcription, lead scoring, full office rollout | 4–6 wks | If offline sync proves heavy, MVP = read-only offline cache + online-only writes; full queue in polish. |
| 3 | Digital pink card: templates from scanned card, role-gated steps, TV board, **30 day parallel run** | Auto-notifications, document attachments per step, analytics | 3–4 wks build + 30 day parallel | If parallel run surfaces process disputes, freeze digital changes and resolve process first. Software does not referee the office. |
| 4 | TMO read sync + loan dashboard + borrower payment portal (rungs 1–2) | Payoff quote generator, delinquency workflows | 4–8 wks | **If TMO API access costs > ~$5K/yr or lacks usable endpoints/webhooks:** pivot to TMO's hosted borrower portal for payments + scheduled export/import for the dashboard. |
| 5 | Syndication: Land.com feed + Meta API + self-hosted scheduler. Brand site migrations **with full 301 redirect protocol per brand** | Remaining channel APIs, per-channel analytics | 4–6 wks | If a portal feed spec is hostile, that channel goes manual; do not let 1 channel block the phase. |
| 6 | Buyer chatbot + first drone orthomosaic overlay (Lohn Hollow) | Photo auto-tagging, internal copilot | 3–5 wks | If parcel CAD data quality is bad for a ranch, overlay ships boundary-only; improvements layer added per ranch as flown. |
| 7 | E-sign + RON + reservation-to-close flow (rungs 3–5) | Full KYC automation, county recording integration | 8–12 wks + legal review | **Gated on compliance review of owner finance origination (see §9.2). No legal sign-off, no automation.** |

Total: roughly 9 to 14 months alongside existing duties. Phases 0 through 3 MVPs in the first ~90 days is the credibility window for the day-60 salary conversation and beyond.

---

## 9. Landmines (flag now, not later)

1. **The Mortgage Office API access.** Everything in Phase 4 depends on what TMO actually exposes (they have an API/SDK and a hosted borrower portal product, but access tiers and pricing vary). Get their integration docs and pricing in week 1. Kill criteria and fallback are pre-set in §8.
2. **Owner finance regulation.** Seller financing on tracts that buyers may live on can trigger SAFE Act / Dodd-Frank RMLO (Residential Mortgage Loan Originator) requirements. Pure unimproved recreational land is generally outside it, but "buyer puts a home on it" blurs lines. Ranch Enterprises Loan Servicing presumably has this handled today — confirm before automating originations in Phase 7, because automating a compliance gap scales the gap.
3. **AI description liability.** Texas DTPA exposure if generated copy misstates amenities. Mitigated by the structured-fields-only rule and the human approval gate in §5.5. Those 2 guardrails are non-negotiable.
4. **SEO migration risk.** Cutting over a brand site without the 301 redirect protocol in §5.1 torches years of county-page rankings and craters organic lead flow. RealStack does not get cancelled per brand until redirects are verified.
5. **Zillow/Realtor.com require MLS.** Set the boss's expectations: direct feeds to those portals are not a thing for non-MLS listings. Land.com network is the real channel for this inventory.
6. **TREC advertising rules.** Every brand site needs correct broker identification, IABS, and Consumer Protection Notice links. Easy to template once, lawsuit bait if skipped.
7. **ACH compliance.** Use a processor (Dwolla, Stripe, Moov) — never store bank credentials yourself. NACHA rules on debit authorization for recurring loan payments need written/electronic authorization records.
8. **FAA Part 107** for commercial drone flights.
9. **Data ownership exit from RealStack.** Before cancelling, export everything (photos, descriptions, historical leads) — confirm contract terms on data export and any term commitments.
10. **Single point of failure: you.** Document as you build (schema docs, runbooks, this file in Git). The platform's value to the company collapses in a sale/succession scenario if only Hayden can run it. Also strengthens the compensation case rather than weakening it: indispensable systems beat indispensable secrecy.

---

## 10. System KPIs (REX measures itself)

These numbers are both the operating dashboard and the salary negotiation exhibit. Baseline them BEFORE Phase 2 ships so before/after is provable.

| KPI | Baseline (measure now) | Target | Where it shows |
|---|---|---|---|
| Lead response time (inquiry → first contact) | Unknown, measure manually for 2 wks | < 1 hr business hours | CRM dashboard |
| Cost per lead, per channel | Pull from FB Ads + Land.com spend | Channel-ranked monthly | Campaigns table |
| Days from contract to close (pink card relay time) | Time 5 current deals by hand | Cut by 50%+ | Deal tracker |
| Listing freshness (sold inventory still showing) | Audit current sites once | 0 listings > 24 hrs stale | Staleness report |
| Lead → contract conversion by salesman | Not currently measurable | Trend visibility | Scoreboard |
| Organic traffic per brand | Search Console, capture pre-migration | No post-migration drop > 10% at 60 days | GSC + redirect hits |

---

## 11. Immediate Next Steps

1. **Init the Git repo and commit this doc.** Weekly commits = deliverable log.
2. Scan a pink card and transcribe every step into a `checklist_templates` draft.
3. Call The Mortgage Office rep: API/SDK access, borrower portal pricing, webhook support. (Feeds the Phase 4 kill criteria decision.)
4. Hand-time 5 current deals (contract to close) and 2 weeks of lead response times. KPI baselines die if not captured before the system changes behavior.
5. Crawl all 12 RealStack sites with Screaming Frog and archive the URL exports. Export full data backup from RealStack (photos, copy, leads).
6. Confirm which entity holds the broker license and MLS membership status.
7. Stand up Phase 0: staging + prod Supabase projects, audit log triggers, backups to R2, Turborepo.
8. Pick the pilot salesman and tell him he is the pilot.
9. Get Part 107 study materials if drone scanning starts this summer.
10. Sketch wireframes: map search page, listing page, salesman lead view, pink card board.
