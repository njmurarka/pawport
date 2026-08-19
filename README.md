# PawPort — maintainer guide

This is a small, free web app that walks someone through bringing a dog into Japan from any other country. It's a plain website — no server, no database, no account system, no build step. That's on purpose: it costs nothing to run, it's easy to host, and you don't need to be a developer to keep it alive. You *will* want a little comfort editing a text file to keep the content current, and this guide covers exactly what you need.

## What's in this folder

```
index.html              The whole app shell (one page; sections swap via JavaScript)
css/styles.css          All the styling — colors, layout, responsive behavior
js/app.js               All the logic — the wizard, the checklist engine, date math
data/checklist-data.json   ALL of the actual content — this is the file you'll edit
README.md               This file
```

You will almost never need to touch `index.html`, `css/styles.css`, or `js/app.js` to update content. Nearly everything a non-developer would want to change — questions, checklist items, country-specific notes, FAQ, glossary, the case study — lives in `data/checklist-data.json`.

## Try it locally before you change anything

Because browsers restrict loading local files with `fetch()`, you need a tiny local server to preview the site (this is normal and only affects local testing — real hosting works fine without it). From a terminal, inside this folder:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser. Stop the server later with Ctrl+C.

If you don't have Python, any static server works — `npx serve .` (needs Node.js) does the same thing.

## Editing content: `data/checklist-data.json`

This is a JSON file — it looks like code, but it's really just structured text. A few rules that matter:

- Every piece of text goes in double quotes: `"like this"`.
- Every item except the last one in a list needs a comma after it.
- If your text itself needs a double quote inside it, write it as `\"` instead.
- After editing, validate it before uploading — paste the file's contents into [jsonlint.com](https://jsonlint.com) and it'll tell you exactly where a comma or quote is missing. A single missing comma will break the entire app, so always validate before you publish.

### Things you'll likely want to do

**Update your own voice on the About page.** That's actually in `js/app.js`, not the JSON file — search for `renderAbout` near the middle of the file and edit the text between the quotes. It's plain sentences, safe to rewrite freely as long as you keep the surrounding `'<p>...</p>' +` structure intact.

**Add a country's specific details.** Open `data/checklist-data.json` and find `"countryDetails"`. There's a `"default"` entry (generic advice used as a fallback) and a growing set of per-country entries. Each country entry can have up to three fields: `form-ac` and `gov-endorsement` (the outbound leg — what local paperwork accompanies Japan's Form AC, and who endorses it) and `return-import-home` (the return leg — what that country's own agency requires to bring the dog back home from Japan). To add or improve a country, copy an existing block, change the code to that country's two-letter code (matching the `"countries"` list further up the file), and fill in real, sourced information — never guess an agency or form name; this app exists specifically because guessed/wrong advice costs people months.

**Add a country to the dropdown.** Find `"countries"` near the top of the file. Each entry looks like:
```
{ "code": "CA", "name": "Canada", "designated": false }
```
Copy a line, give it the right two-letter code and name. Only set `"designated": true` if that country is genuinely on Japan's current official list of rabies-free "designated regions" (double-check at the MAFF link in the Resources page before doing this — getting it wrong could send someone down the wrong process).

**Edit or add an FAQ / glossary entry.** Find `"faq"` or `"glossary"` — each is just a list of `{ "q": "...", "a": "..." }` or `{ "term": "...", "definition": "..." }` objects. Copy an existing one, edit the text, keep the commas.

**Edit a checklist item's wording.** Find `"checklistItems"`, locate the item by its `"title"`, and edit the `"body"` text. Leave `"id"`, `"category"`, and `"showIf"` alone unless you're deliberately changing when that item appears — those are what make the checklist personalized.

**Update the case study.** Find `"caseStudy"` near the end — it's a single `"title"` and `"summary"`. This is meant to stay anonymized (no full names, no document numbers, relative facts rather than facts tied to one identifiable family) even as you add more color to it.

### Things that need a bit more care

The `"wizard"` and `"checklistItems"` sections use a small `"showIf"` system to decide what to show based on earlier answers (for example, the FAVN test questions are hidden entirely for the handful of "designated region" countries). If you want to change *when* something appears rather than just its wording, look at how similar existing items use `"showIf"` and copy that pattern — `{"field": "...", "equals": "..."}`, `{"field": "...", "in": [...]}`, or `{"field": "originCountry", "isDesignated": true/false}`. If you're not sure, it's safe to hand the file to an AI assistant (like Claude) and describe the change you want in plain language — the structure is simple enough that most assistants can make the edit correctly for you.

## Deploying it for real (free options)

You don't need to buy hosting. All three of these are free for a site this size:

**Netlify (easiest)** — Go to [app.netlify.com/drop](https://app.netlify.com/drop) and drag this whole folder onto the page. It gives you a live URL immediately. To update later, just drag the folder again.

**Vercel** — Similar drag-and-drop flow at [vercel.com/new](https://vercel.com/new), or connect it to a GitHub repo for automatic redeploys whenever you push a change.

**GitHub Pages** — If you put this folder in a GitHub repository, go to the repo's Settings → Pages, and point it at the main branch. GitHub gives you a free `username.github.io` URL.

Any of these also let you connect a custom domain later if you want something like `yourdogname.com`.

## Testing (for developers)

There's now an automated test suite in `tests/`, using Playwright. It requires Node.js:

```
npm install     # one-time — downloads Playwright and a browser
npm test        # runs everything
```

This walks the actual wizard through every meaningfully different combination of answers (not just a few examples) and checks that going back and changing an earlier answer correctly updates everything that depends on it — that's the single easiest way to accidentally introduce a bug in a checklist like this, so **run `npm test` after editing anything in the `"wizard"` section's `"showIf"` rules, or anything in the `getEffectiveAnswers()` function in `js/app.js`.** See `CLAUDE.md` for more detail if an AI assistant is helping with this.

## A note on accuracy

The content here reflects real research and real experience as of the date in `"lastVerified"` at the top of the JSON file (also shown in the site's footer). Immigration and animal-import rules change. Before you publish an update, or every so often even if nothing's changed on your end, it's worth re-checking the official MAFF links in the Resources page and updating `"lastVerified"` to today's date so visitors know how fresh the content is.

## Where this could go next

This version is intentionally simple: no accounts, no database, progress is saved only in each visitor's own browser (so it won't follow them from phone to laptop, and clearing browser data clears their checklist). If this grows and you want cross-device saved progress, community-contributed country guides, or a proper content-editing screen instead of hand-editing JSON, that's a natural next version — built as a real web app with a backend — but none of the content or checklist logic here would be wasted; it would just move into that new structure.
