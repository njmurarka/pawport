# Vendored third-party code

**html2canvas.min.js** — v1.4.1, from https://html2canvas.hertzen.com, MIT
licensed, unmodified. Powers the "Download as image" / "Download as PDF"
buttons on the results page. Vendored (copied into this repo) rather than
loaded from a CDN so those buttons keep working even if a third-party CDN
is slow, blocked, or down — this project already got burned once by an
external dependency (GitHub's API rate limit) failing unpredictably for a
real visitor.

To update: download the new minified build from
`https://unpkg.com/html2canvas@<version>/dist/html2canvas.min.js`, replace
this file, and bump the `?v=` on ITS OWN script tag in `index.html` (same
cache-busting rule as the site's own css/js/data files — see CLAUDE.md).

**goatcounter-count.js** — GoatCounter's `count.js` from https://gc.zgo.at/count.js
(downloaded 2026-10-21), ISC licensed (header in the file), unmodified.
Anonymous, cookie-free visit counting for https://portdog.goatcounter.com.
It's loaded with `no_onload` and `js/app.js` calls `goatcounter.count()`
per hash route and for a few named milestones (never any answers or
personal data). It ignores localhost, so tests/dev never send anything.
To update: re-download the file and bump the `?v=` on its script tag.
