# PawPort — Project Memory & Handoff

This file is a full working-context dump of everything covered while building this project, so any future session (or contributor) can pick it up without re-deriving decisions from scratch. It intentionally keeps the same privacy stance as the rest of this repo — no real personal names, no city/state/province — because this repo is connected to a public GitHub remote (`github.com/njmurarka/pawport`) intended for GitHub Pages hosting. Fuller private research notes (with real dates, names, and document numbers from the original case this app is based on) live outside this repo, in a private Claude Project; they are deliberately not reproduced here.

## What this project is

PawPort is a free, personalized, step-by-step web app that walks someone through the process of bringing a dog into Japan from any other country. It exists because the maintainer went through this process for their own dog and found the available advice scattered, sometimes contradictory, and occasionally wrong in ways that could have cost months. The app's goal is to spare the next person that friction — a "give back" project, not a commercial one.

Core framing: destination is always Japan; origin is "any other country." Health-condition questions (heart conditions, brachycephalic breeds, senior dogs, mobility issues) are baked in because the maintainer's own dog has a heart condition, and fitness-to-fly is a real, separate concern from the import paperwork itself.

## Product decisions and why (from the original build discussion)

Three architecture forks were deliberately decided before building, each with a recommended-and-chosen option:

1. **Interaction model: guided wizard + generated checklist, not an AI chatbot.** A conversational AI assistant was considered and rejected for the core experience because a wrong answer on a hard deadline (e.g., the rabies-booster reset trap, see below) costs the user months, and an LLM can confidently hallucinate a wrong date. The wizard is deterministic: a fixed set of questions feeds a rules engine that computes real dates and shows/hides checklist items. No AI API, no backend, no per-message cost, no hallucination risk on load-bearing facts.
2. **Tech stack: static site, no build step.** Plain HTML/CSS/vanilla JS. All content — wizard questions, checklist items, country-specific detail, glossary, FAQ — lives in one data file, `data/checklist-data.json`, so the non-developer maintainer can extend content later without touching code. Deploys free on GitHub Pages / Netlify / Vercel with a simple file copy.
3. **Content scope: generic framework, one deeply-detailed worked country.** The wizard and checklist logic work for any origin country. Canada is the one country with fully fleshed-out specific detail (`countryDetails.CA` in the data file), since that's the maintainer's own researched case. Every other country falls back to generic guidance with "verify locally" framing.

## Architecture

- `index.html` — single shell page. Loads Google Fonts (Fraunces for display headings, Inter for body), the stylesheet, and `js/app.js`. Has a `<div class="bg-decor">` for the ambient background blobs.
- `css/styles.css` — full design system: CSS custom properties for color/spacing tokens, a warm orange primary gradient + teal accent, Fraunces/Inter font pairing, hover-lift animations on cards/buttons, a route-change fade-in animation, custom modal styling, print stylesheet.
- `js/app.js` — everything else, as a single IIFE:
  - `loadAnswers`/`saveAnswers`/`loadChecked`/`saveChecked` — localStorage persistence (keys `pawport_answers_v1`, `pawport_checked_v1`). Progress is per-device only; there is no account system by design (see "Not yet done" below for the v2 path if that's ever wanted).
  - `computeAllDates(answers)` — the date engine. Given a FAVN blood-draw date, computes the 180-day earliest-travel date, the 2-year outer validity date, a suggested FAVN-redraw-by date (2-year expiry minus 180 days, minus a further 7-day buffer), and — given a last rabies date + labeled duration — a suggested booster-by date (labeled expiry minus 21 days for a 1-year vaccine or 40 days for a 3-year vaccine). Given a travel date, computes the AQS advance-notification deadline (travel date minus 40 days) and the pre-export exam window (opens 10 days before travel).
  - `matches(showIf, answers)` — a small condition-matcher used by both the wizard questions and the checklist items to decide what's currently relevant. Supports `equals`, `in`, `exists`, `isDesignated` (checks the selected country's `designated` flag), and `excludesOnly` (for the health-conditions checkbox group's "None of the above" exclusivity). `showIf` can be a single condition object or an array of conditions (implicit AND).
  - Router: hash-based (`#/home`, `#/wizard`, `#/results`, `#/resources`, `#/about`), re-renders `#app` on every `hashchange`, with a CSS fade-in class re-triggered on each navigation.
  - Wizard: renders one question at a time from the *currently visible* subset of `DATA.wizard` (filtered live by `matches`, since answering "designated region" skips the whole rabies/FAVN branch). Radio and checkbox options are rendered as `<label>` elements wrapping their `<input>` — this was a deliberate fix for a real bug: binding a click handler to the outer row instead of the input's own `change` event double-fires when the click lands on label-forwarded text (the label's own click event bubbles once, and the synthetic click it forwards to the input bubbles a second time, both reaching the same ancestor). Only ever listen on the input's `change` event, never on a wrapping row's `click`, for exactly this reason if this code is touched again.
  - Results page: filters `DATA.checklistItems` by `matches(item.showIf, answers)`, groups by `DATA.categories`, injects computed dates via each item's optional `computedDate` key, and appends country-specific detail (`item.countryNote`) by looking up `DATA.countryDetails[country.code][item.id]` falling back to `DATA.countryDetails.default[item.id]`.
  - Export/import: `openExportModal()` builds a JSON payload (`{pawportExport, version, exportedAt, answers, checked}`), offers a file download (via a Blob + temporary `<a download>`) and a copy-to-clipboard button (with an `execCommand('copy')` fallback for browsers without the async Clipboard API). `openImportModal()` accepts either a file upload (`FileReader`) or pasted text, validates the parsed JSON has an `answers` object, and writes it back into localStorage before re-rendering. Both are wired in from the results page's action row, the "no answers yet" empty state, and a quiet link on the home page.
- `data/checklist-data.json` — all content. Key sections:
  - `countries` — ~48 entries, each with a `designated` boolean. Only six real entries are currently marked `designated: true`: Iceland, Australia, New Zealand, Fiji, Hawaii (as `US-HI`, distinct from mainland US), and Guam (`GU`) — this list was verified live against MAFF's official page (`maff.go.jp/aqs/english/animal/dog/import-free.html`) during the build, not assumed. Canada additionally carries `richDetail: true`.
  - `wizard` — the question set: origin country, dog name/breed (optional, personalization only), health conditions (checkbox group), microchip status, rabies-dose count + last date + labeled duration, FAVN status + date, travel date (optional), and a transit-country question. The rabies/FAVN questions are hidden entirely (`showIf: {field:"originCountry", isDesignated:false}`) for designated-region countries.
  - `categories` — the six checklist groupings: Foundations, Antibody Testing & Timing, Paperwork & Government Sign-off, Health & Fitness to Fly, Travel Logistics, Arrival in Japan.
  - `checklistItems` — ~22 items. Facts baked in here were verified live against MAFF's official guide (`maff.go.jp/aqs/animal/dog/attach/pdf/import-other-42.pdf`) during the build: two rabies doses ≥30 days apart, first dose after microchip implant, dog ≥91 days old at first dose, FAVN/RFFIT titer ≥0.5 IU/mL at a designated lab, 180-day minimum wait, 2-year validity conditional on unbroken vaccine coverage, 40-day advance notification to AQS (by email, to the port-of-entry office — applies to designated-region imports too), 10-day pre-export clinical exam window (also applies to designated regions), and the specific gotcha that microchips with the `900 202` prefix are currently rejected by Japan.
  - `countryDetails` — `default` (generic) and `CA` (Canada-specific: Form AC vs. the generic CFIA export certificate, CFIA endorsement process).
  - `caseStudy` — the single flagship worked example, anonymized: a Papillon named **Miso** (renamed from the real dog's name on request), Canada → Japan, describing the same-day microchip/vaccine/blood-draw visit, the blue-ink myth, the two-dates-on-one-certificate confusion, and the asymmetric buffer philosophy — with no real names, no city, no document numbers.
  - `glossary` and `faqGroups` — see below.

## The FAQ's buffer explanation (rewritten once already — the most-revised piece of content)

The FAQ was substantially rewritten after initial feedback that the soft-buffer/hard-buffer distinction was skimmed over. It's now a dedicated, hierarchical group — `faqGroups[0]`, titled "Understanding your deadlines (read this one first)" — broken into five sequential questions rather than one dense answer:

1. How the FAVN test's 180-day wait and 2-year validity work together (with a worked date example).
2. How and when to do a FAVN redraw if a trip might land past the 2-year window (the "true no-gap deadline" = old validity end minus 180 days).
3. Why the redraw only needs a small (~1 week) buffer — it's a **soft failure**: being late just costs a proportional delay, nothing resets.
4. Why the rabies booster deadline needs a much bigger buffer (several weeks) — it's a **hard failure**: any gap in vaccine coverage voids the FAVN result entirely, forcing a full restart (new vaccination series, new blood draw, new 180-day wait — six-plus months).
5. The one-line rule of thumb: size the buffer to the cost of being late.

Three other FAQ groups follow: "Paperwork myths & mix-ups" (the blue-ink myth, the CFIA-generic-certificate-vs-Form-AC trap), "Health & travel logistics" (fitness-to-fly, transit-country rules), and "At the airport" (what happens if documents are wrong — up to 180 days of quarantine).

If this section needs editing again, keep the same "define the mechanism → work a concrete date example → state the consequence → give the rule" structure — that's what fixed the original complaint that it was too abstract.

## The "Our story" (About) page

Rewritten once from a short generic placeholder into a full, date-anchored narrative, per an explicit request for "way more detail." It uses the maintainer's real timeline (the real March 24, 2026 combined microchip/vaccine/blood-draw date, the real travel dates, the real buffer-target dates) but keeps every personal/place identifier out: no city, no clinic name, no vet name, no lab name, no dog's real name, no owner's name. Countries are named explicitly (Canada, United States, Japan) since that was explicitly permitted.

Content covers, in order: how the process started; two pieces of advice that turned out wrong or incomplete (the blue-ink myth, the generic-certificate trap); the genuinely unresolved question of whether Canada or the United States counts as "the exporting country" given a drive-through-the-US-then-fly-from-a-US-airport route, and the decision to get export certificates from **both** countries rather than guess; the two-different-failure-modes deadline explanation (same content as the FAQ, in narrative form); why this mattered beyond paperwork (the heart condition, and decoupling the surgery decision from the travel deadline); and a closing invitation for readers to help resolve the one open question.

This page was drafted using the `my-writing-style` skill's "technical explainer" register (assertion-heavy, no hedging words, causal mechanism → consequence → implication structure, prose over bullets) since it's content the maintainer will publish as himself.

## Design system

Rewritten once from a plain functional style to a more polished one, on explicit request to make it "sexier looking." Key choices:
- Fonts: **Fraunces** (a display serif, via Google Fonts) for all headings, **Inter** for body text.
- Color: warm orange gradient primary (`--gradient-primary`, roughly `#ff9d5c → #e2652c → #c14e1c`) plus a teal accent (`--color-accent`), on a warm off-white background with soft blurred ambient color blobs behind the whole page (`.bg-decor`).
- Motion: hover-lift + shadow on buttons and cards, a gradient progress bar with smooth width transitions, a rotating chevron on FAQ accordion items, a fade-in-and-rise animation on every route change, and a pop-in animation on modals.
- The header uses a sticky, backdrop-blurred nav bar with an animated underline on hover/active links.

## Testing approach

No test framework is committed to the repo, but the build was validated at each major step using ad hoc Playwright scripts (Chromium at `/opt/pw-browsers/chromium`) run from a scratch npm install, covering: the full wizard flow for both a non-designated country (Canada, with all fields filled) and a designated country (Australia, confirming the FAVN/rabies questions are correctly skipped); that the computed buffer dates exactly reproduce the maintainer's own independently-hand-calculated real dates; the designated-region banner and simplified checklist; localStorage persistence across a reload; the full export → wipe storage → import round trip (both file and paste paths) restoring both answers and checked state; a deliberately-malformed-JSON import showing a clear error instead of failing silently; mobile-width nav toggle behavior; and zero unexpected console errors throughout. One real bug was caught and fixed this way: the double-fire issue on radio/checkbox `option-item` clicks described above.

## Privacy stance (why names/places are scrubbed)

The repo's git remote is `https://github.com/njmurarka/pawport.git`, set up for GitHub Pages hosting — i.e., public. Every piece of app content and this memory file itself deliberately excludes: the real dog's name, the real owner's name, city/province/state, clinic name, vet name and license number, exact microchip number, lab report number, and billing-entity details. Countries are fine to name. If a future session is asked to add more real-world detail, keep applying this same filter unless the maintainer explicitly says the repo has gone private or he wants something de-anonymized.

## Deployment status as of this writing

**Live and fully deployed as of 2026-08-18 at https://pawport.duckdns.org/** — DNS, GitHub Pages, and HTTPS are all confirmed working end-to-end.

- The site's current file set (`index.html`, `css/`, `js/`, `data/`, `README.md`) was pushed to `origin/main` at `github.com/njmurarka/pawport`.
- DuckDNS: the `pawport` subdomain was created on duckdns.org's site (this is a separate manual step from generating the API token — the update API 404s/`KO`s until the subdomain exists there first). Its A record now points to `185.199.108.153`, one of GitHub Pages' four IPs — confirmed resolving via `dig`.
- GitHub Pages: enabled, serving from the `main` branch root. Custom domain `pawport.duckdns.org` set via `gh api -X PUT repos/njmurarka/pawport/pages -f cname='pawport.duckdns.org'`, which caused GitHub to auto-commit a `CNAME` file to the repo (pull that into any local clone). HTTPS certificate is `approved`, and enforcement was turned on via `gh api -X PUT repos/njmurarka/pawport/pages -F https_enforced=true` — note `-F` (typed value) not `-f` (string), since the endpoint rejects `"true"` as a string for a boolean field.
- Domain *verification* (the TXT-record anti-hijacking step) was intentionally skipped, per the plan below — not required for the site to serve over HTTPS.
- **Security note:** the maintainer pasted his live DuckDNS API token directly into chat twice across two sessions. It was used transiently (never written to any file, memory, or commit) to make the DNS update call, but he was advised both times to regenerate it on DuckDNS's site as a precaution. Confirm this was actually done in a future session if it comes up.
- The DuckDNS-to-GitHub-Pages plan that was executed:
  1. Because DuckDNS only supports A/AAAA/TXT records (no CNAME to an arbitrary host), the **apex-domain** path in GitHub's custom-domain docs applies, not the subdomain/CNAME path — even though `pawport.duckdns.org` looks like a subdomain.
  2. Set DuckDNS's A record for `pawport` to one of GitHub Pages' four IPs (`185.199.108.153`, `.109.153`, `.110.153`, `.111.153`). DuckDNS's update API only accepts one IP per call, so only one of the four is set — a minor redundancy tradeoff versus setting all four.
  3. Add `pawport.duckdns.org` as the custom domain via the Pages API; GitHub writes the `CNAME` file automatically.
  4. Wait for GitHub's DNS check and automatic HTTPS certificate provisioning, then enable "Enforce HTTPS."
  5. Skip GitHub's optional account-level domain *verification* — DuckDNS's API can't create the required TXT record on an arbitrary sub-label, and it isn't needed for HTTPS to work.
- **Tooling note, resolved:** an earlier session found this cloud sandbox's egress blocked to `duckdns.org` (403 from the sandbox's own proxy). That is no longer the case as of this session — `curl` to `duckdns.org` and the DuckDNS update endpoint both succeeded directly from the sandbox. `gh` auth also needed a fresh interactive `gh auth login -h github.com` from the maintainer (the keyring token had gone invalid) before Pages API calls would work.

## Session 2 (2026-08-18): quiz-logic hardening, dark mode, decision-tree audit, per-country research

This was a long single-day session that moved the app from "working" to
"defended by tests." In rough chronological order:

### Bugs found and fixed in the wizard/results engine

1. **The original bug report:** answering "no microchip" still asked "how
   many rabies vaccinations since the microchip was implanted" — a
   nonsensical question. Fixed by gating `rabiesDoses`/`favnDone` on
   `microchipDone === 'yes'` in their `showIf`, and introducing
   `getEffectiveAnswers()` in `js/app.js` to normalize stale downstream
   answers whenever an earlier answer in the chain changes.
2. **Missing-warning bug:** the results page gave no indication when a
   stated travel date was actually impossible (e.g. no FAVN done yet,
   flying in a week). Added a **feasibility engine**
   (`computeFeasibilityAlerts`) that renders unmissable red/orange banners
   at the top of the results page for: FAVN 180-day wait not met, FAVN
   about to expire, rabies coverage lapsing/lapsed, and the 40-day AQS
   advance-notification deadline already passed.
3. **`favnDone` question fixed to also require `rabiesDoses === '2+'`** —
   FAVN can't happen after only one dose, same category of bug as #1.
4. **`travelDate` staleness:** changing "do you have a target date" from
   yes to no left the old date in storage, still driving a false
   "impossible" blocker. Fixed by adding `travelDate` to
   `getEffectiveAnswers()`'s normalization.
5. **A second, subtler cascade gap** found while fixing #4: flipping
   `favnDone` directly from yes→no (with `rabiesDoses` staying `'2+'`)
   left a stale `favnDate` behind, because it was only being cleared as a
   side effect of the `rabiesDoses` cascade, not directly on its own
   condition. Rewrote `getEffectiveAnswers()` to mirror each field's own
   `showIf` condition independently rather than nesting them.
6. **The exhaustive audit (see below) found the deepest bug of the day:**
   `getVisibleSteps()` — the function that decides which question the
   WIZARD shows next — was filtering against raw stored answers, not the
   normalized ones. So going back and downgrading `rabiesDoses` from
   `'2+'` to `'1'`, or downgrading `microchipDone` from `'yes'` to `'no'`,
   could still show a now-invalid downstream question (e.g. "date of the
   FAVN blood draw" after just saying only one rabies dose has happened).
   Fixed by having `getVisibleSteps()` filter against
   `getEffectiveAnswers(answers)` instead of raw `answers` — the exact
   same normalization now drives both wizard navigation and the results
   page, one source of truth.

**Lesson worth remembering:** two rounds of "fix the bug you found" were
each individually correct but incomplete, because they normalized answers
at the RESULTS page without also normalizing them for WIZARD NAVIGATION.
The fix that finally closed all the gaps was building an exhaustive,
UI-driven test (not spot checks) and letting it find every remaining hole
at once. See `tests/wizard-exhaustive.test.js`.

### Exhaustive decision-tree audit and permanent tests

Added a real test suite under `tests/`, checked into the repo (previously
all testing was ad hoc, scratchpad-only, and thrown away each session):
- `tests/wizard-exhaustive.test.js` — walks the REAL wizard UI through
  all 66 structurally-distinct combinations of the conditional-field
  chain, asserting the exact question sequence at every step against an
  independent oracle, plus 6 targeted "go back, change an answer,
  continue" mutation replays through the real UI (this is what caught bug
  #6 above).
- `tests/date-feasibility.test.js` — the blocker/urgent alert engine.
- `tests/regression.test.js` — dark mode, the header-width bug the theme
  toggle caused, the build-info footer's rate-limit fallback.
- `npm install && npm test` runs everything. See `CLAUDE.md` for the
  rules this depends on (cache-busting bumps, keeping `showIf` and
  `getEffectiveAnswers()` in sync).
- Two genuine TEST bugs were found and fixed along the way, worth
  remembering if touching these tests again: (a) reusing one Playwright
  page across many sequential wizard walks without clearing localStorage
  makes every walk after the first RESUME instead of starting fresh
  (the wizard's resume-progress feature working as intended, just wrong
  for a test that wants a clean slate); (b) `waitForSelector('.results-header, .card')`
  is a race — `.card` is generic enough to match the still-present prior
  page during the async hashchange re-render, so it returns before the
  new page actually populates. Always wait on `.results-header` alone.

### Dark/light theme toggle

Added a header toggle (icon + label, icon-only below 1080px width),
default light, remembered via a cookie (`pawport_theme`, not
localStorage — explicit user request), applied before first paint via an
inline script in `index.html`'s `<head>` so there's no flash on reload.
Full dark palette as CSS custom properties, redefined under
`:root[data-theme="dark"]` — see `CLAUDE.md` for the "never hardcode a
color" rule this depends on.

**Regression this caused and fixed:** the added toggle pushed header
content past the 900px width it shared with body content, wrapping nav
links onto two lines at most desktop/laptop widths (not just narrow
ones — reproduced from 721px up to 1440px). Fixed by giving the header
its own wider wrap (1180px), making the toggle icon-only through the
whole "nav still inline but not spacious" range, and raising the
mobile-hamburger cutover from 720px to 900px so inline nav never has to
squeeze into too little room again.

### Footer build stamp

Replaced the old hand-maintained "Content last reviewed" line with a
live "Last published: [date] ([viewer's timezone])" plus a tiny, faint,
clickable commit-hash link — both derived from a live fetch to GitHub's
commits API (`api.github.com/repos/njmurarka/pawport/commits/main`) so
neither needs manual updating. **This broke once already:** GitHub's
unauthenticated API is capped at 60 requests/hour per IP, shared across
whatever NAT/proxy a visitor's traffic sits behind, and a visitor hit an
exhausted IP, seeing a bare "—" with no hash link. Fixed with a
hand-maintained fallback (`fallbackCommitHash` / `fallbackPublishedAt` in
`checklist-data.json`, rendered immediately, overwritten if the live
fetch succeeds) — bump those two fields by hand alongside deploys.

### Cache-busting

Discovered a visitor was seeing a stale cached copy of the site after a
deploy (missing a feature that was confirmed live in the served HTML).
Added `?v=N` query params to `css/styles.css`, `js/app.js`, and the
`checklist-data.json` fetch — **must be bumped by hand on every edit to
those files**, there's no build step to do it automatically. See
`CLAUDE.md` for the current convention.

### "Why is this asked?" help popups

Added a `why` field to every wizard question in `checklist-data.json`
(distinct from the existing short inline `help` hint) and a small "?"
button next to each question label that opens a modal with the fuller
rationale — reusing the existing export/import modal system rather than
building a new one.

### Per-country agency/forms research — completed

The maintainer asked for the app to cover, at minimum, which government
agency and which form(s) are needed for EVERY country — both the
outbound (into Japan) leg (previously only Canada had this) and,
explicitly requested despite the extra research burden, the RETURN leg
(Japan's own export process, plus each origin country's own
re-entry/import rules for a dog coming back from Japan specifically).

Added a new "Returning Home" category and two checklist items:
`return-japan-export` (generic — Japan's own AQS export process:
apply via NACCS at least 14 days ahead, inspection within 10 days of
departure, English export certificate issued on the spot; a Power of
Attorney is needed if someone else brings the dog to inspection) and
`return-import-home` (per-country, using the same
`countryDetails[code][itemId]` note-lookup pattern already used for
Form AC/gov-endorsement).

**All 47 real countries (excluding the generic `OTHER` fallback) now
have researched `form-ac`, `gov-endorsement`, and `return-import-home`
entries in `countryDetails`.** Research was dispatched to parallel
subagents by region, instructed to mark anything unverified as
`"confidence":"general"` (visible in the source research, not currently
surfaced in the UI text itself) rather than fabricate a plausible-
sounding agency name. A few countries (China, South Africa, UAE, Saudi
Arabia, Israel) have official-source pages that repeatedly blocked
automated fetches, so their entries are more hedged/general than most —
worth a follow-up pass with a human or a different fetch path if this
matters for real users from those countries. One substantive finding
worth remembering: **Fiji is asymmetric** — it's one of Japan's own
designated (simplified, no-FAVN) regions for the *outbound* leg, but
Fiji's own Biosecurity Authority (BAF) classifies Japan as its stricter
"Group B" for the *return* leg, requiring a full rabies titer test and a
30-day quarantine — the opposite of what the outbound simplification
might lead someone to assume.

**Mid-research, the account hit its usage limit and every in-flight
research agent failed simultaneously** (including, apparently, agents
from an unrelated concurrent Claude Code session on the same repo,
"pawport-2d" — gone/unreachable by the time this was investigated, no
conflicting commits found, and it may have actually been contributing
useful results via cross-session messages rather than truly unrelated).
Re-launched after the limit reset and finished from there.

**Caveat for future sessions:** this content was researched by AI agents
against official sources where reachable, not fact-checked by a human
or by the maintainer's own experience (unlike the Canada content, which
is lived experience). Treat it as a strong first draft, not gospel —
the per-item wording already says "confirm directly" for anything
genuinely uncertain, but rules do change, and a periodic re-verification
pass (or maintainer review) would be worth doing before leaning on this
too heavily for a real trip.

## Open items / not yet done

- Confirm the maintainer regenerated the DuckDNS token after pasting it in chat.
- Per-country research is complete (all 47 countries) but AI-researched, not human-fact-checked — see the caveat immediately above before treating it as gospel.
- The exporting-country ambiguity (Canada vs. the country a flight happens to depart from, for a route that transits a third country overland) is explicitly unresolved in the "Our story" content — flagged there as the single open question the maintainer is still hedging on by obtaining both countries' export certificates.
- No accounts / cross-device sync beyond the manual export-import-JSON feature — intentional for v1; a real backend (accounts, admin content-editing UI) is the natural v2 if this gets traction, and was scoped from the start so none of the current logic/content would be wasted in that migration.
- The "Our story" page uses the maintainer's real voice/timeline already; further personalization is optional, not required.
