# CLAUDE.md — working notes for this repo

PawPort is a free, static (no build step) web app that walks someone through
bringing a dog into Japan from any other country, and back home again. See
`PROJECT-MEMORY.md` for the full narrative history and product decisions —
this file is the short, operational version: what to do, not why.

## Architecture in one paragraph

`index.html` + `css/styles.css` + `js/app.js` (one IIFE, hash router) +
`data/checklist-data.json` (all content — wizard questions, checklist items,
per-country detail, FAQ, glossary). No framework, no bundler. Deployed via
GitHub Pages directly from `main`, custom domain `pawport.duckdns.org`.

## Rules that must not be violated

1. **Cache-busting.** `index.html` loads `css/styles.css?v=N`,
   `js/app.js?v=N`, and `js/app.js` itself fetches
   `data/checklist-data.json?v=N`. **Bump the relevant `?v=` number by hand
   every time you edit that file.** There is no build step to do this
   automatically — forgetting it means real visitors can silently keep
   serving a stale cached copy after a deploy (this has already happened
   once). Check current values with:
   `grep -n "?v=" index.html js/app.js`

2. **Wizard dependency chain.** The wizard has a chain of fields that gate
   each other: `originCountry` (→ `designated`) → `microchipDone` →
   `rabiesDoses` → `favnDone` → `favnDate`, and separately
   `travelDateKnown` → `travelDate`. Every one of these relationships is
   enforced TWICE, and both places must stay in sync if you add or change a
   conditional field:
   - `DATA.wizard[i].showIf` in `data/checklist-data.json` — controls which
     question is asked next.
   - `getEffectiveAnswers()` in `js/app.js` — normalizes stale answers left
     over from before an earlier answer changed, for BOTH `getVisibleSteps`
     (wizard navigation) and the results/checklist page. If you add a new
     conditional field, add a corresponding normalization line here that
     mirrors its `showIf` condition exactly, using the already-normalized
     `eff` values (not raw `answers`) so it cascades correctly.
   - Getting this wrong is exactly how three real bugs shipped: a
     microchip/rabies question asked in a nonsensical order, a stale
     `travelDate` driving a false "impossible" warning after the user
     changed their mind, and a stale `favnDate` surviving a direct
     `favnDone` flip. All three are now covered by
     `tests/wizard-exhaustive.test.js` and `tests/date-feasibility.test.js`
     — **run `npm test` after touching anything in this chain.**

3. **No fabricated regulatory facts.** This app exists because scattered,
   sometimes-wrong advice cost the maintainer real time. Per-country
   agency/form names in `countryDetails` must come from an actual official
   government source (or be explicitly marked as general fallback guidance)
   — never invent a plausible-sounding agency name. See `PROJECT-MEMORY.md`
   for which countries are verified vs. general-fallback as of the last
   research pass.

## Testing

```
npm install   # one-time, fetches Playwright + browser binaries
npm test      # runs everything in tests/
```

`tests/wizard-exhaustive.test.js` walks the real wizard UI through every
structurally-distinct combination of the conditional-field chain (not just a
few samples) and replays "go back, change an earlier answer, continue"
mutations for every field with downstream dependents — this is the direct
regression test for "no impossible decision path." `tests/date-feasibility.test.js`
exercises the blocker/urgent alert engine. `tests/regression.test.js` covers
the dark-mode toggle, the header-width layout bug that toggle caused, and the
build-info footer's rate-limit fallback. Add new cases to the relevant file
rather than starting a new one, unless it's a genuinely new area.

If you add a new checklist item or wizard question, add it to the relevant
oracle function too (`expectedItems()` in wizard-exhaustive.test.js) — the
test is only as good as that independent spec.

## Design system

Every color is a CSS custom property on `:root`, redefined under
`:root[data-theme="dark"]` in `css/styles.css` — never hardcode a hex color
in a component rule; add a token instead so dark mode stays correct
automatically. Theme is an explicit user toggle (not `prefers-color-scheme`),
persisted via a cookie (`pawport_theme`), default light, applied before
first paint by the inline script at the top of `index.html`'s `<head>`.

## Footer build stamp

The footer's "Last published" + commit hash come from a live fetch to
GitHub's commits API, with a hand-maintained fallback
(`fallbackCommitHash` / `fallbackPublishedAt` in `checklist-data.json`) used
whenever that fetch fails (GitHub's unauthenticated API is capped at 60
req/hour per IP, shared across whatever NAT a visitor sits behind — this
has already caused a real, if temporary, blank footer). Bump those two
fields by hand alongside the `?v=` numbers when deploying.
