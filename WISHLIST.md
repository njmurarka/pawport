# port.dog wish list — ideas to make it even better

Written 2026-10-31 after a full read of the app: the wizard and checklist
engine, the deadline math, 47 country notes, the return-home flow, the
9-language system, and who it serves. Many of the first wave of users come
from MVD heart-dog communities, travelling to Japan for mitral valve surgery,
often against a medical clock.

Guiding principles for every item, so the site stays what it is:

- **Free, no accounts, and private by default.** Answers stay on the device. Anything that leaves the device is opt-in and explained.
- **Accuracy over features.** Every new regulatory fact needs an official source, and the stale-translation guard keeps translations honest.
- **Static-site friendly.** Prefer ideas that work without a server.

Effort: **S** (a day or two) · **M** (a week) · **L** (several weeks or ongoing).
⭐ marks my top picks to do first.

---

## Make the deadlines impossible to miss

### 1. ⭐ Add to my calendar (.ics export) — S
One button that adds every computed date to Google, Apple or Outlook calendar, each with a reminder: the safe booster-by date, the 180-day wait ending, the 40-day AQS notification deadline, the pre-export exam window, and the earliest retest date.
- **Why:** the app's biggest lesson is that a missed booster resets six-plus months. A calendar alert fixes that, and needs no server or email list.

### 2. ⭐ Visual trip timeline — M
A horizontal timeline from today to arrival in Japan and back home, showing the real windows: the vaccine coverage band, the 180-day wait, the 2-year validity, the 40-day notice and the 10-day exam window. The risky gaps (for example, the booster due date landing in the middle of the trip) are highlighted.
- **Why:** people understand overlapping windows faster as a picture than as a list. It also exports as an image, like the checklist does now.

### 3. "What if?" date slider — S
Drag the travel date and watch every deadline and alert update live. "If surgery moves to March, does my notification deadline still work?"
- **Why:** heart-dog families often can't fix a date until the cardiologist or surgeon confirms one. This takes the guesswork out of moving it.

## Get the paperwork right the first time

### 4. ⭐ Document consistency checker — M
The user types in (or photographs) what's actually on each document: microchip number, implant date, each vaccine date and product, the blood-draw date and the titer. The app then checks the rules:
- the chip is 15 digits and doesn't start with `900 202`, with a warning for the duplicate-`900` prefixes
- the chip came before the first qualifying vaccine
- the doses were at least 30 days apart and within the immunity period
- the draw came after the second dose and the titer is at least 0.5
- the same chip number appears on every document

- **Why:** mismatched paperwork is the most common reason dogs get held at the airport. This turns the "triple-check it yourself" advice into an actual check. Everything runs locally.

### 5. Form AC / Form AB draft helper — M
Pre-fill a draft of Japan's form from the user's answers so the vet has less to transcribe. It would be clearly watermarked "DRAFT, your vet completes the official form", with field-by-field notes such as "date format MAFF expects".
- **Why:** fewer transcription errors on the document that matters most.
- **Before building:** check MAFF's terms for reproducing the form.

### 6. Vet visit sheet, in the vet's language — S
A one-page printout for each appointment ("Visit 1: chip, then vaccine, same day is OK"), with exactly what the vet must do and record, translated into any of the 9 site languages, independent of the owner's language.
- **Why:** many owners' vets have never done a Japan export. One sheet replaces a dozen emails.

### 7. AQS 40-day notification walkthrough — M
A step-by-step guide to filing through NACCS, with:
- a port-of-entry office finder (MAFF lists the airports and seaports that accept dogs)
- copy-ready bilingual email text for when NACCS isn't possible

- **Why:** the app calls this step out as the most commonly missed one. Make it the easiest.

## Built for heart dogs (the community that found us first)

### 8. ⭐ Heart-dog travel module — M
An optional track, turned on when "heart condition" is ticked, that adds:
- questions to take to the cardiologist (fitness to fly, cabin vs. cargo, routing and layover length, medication timing across time zones, how altitude and stress could affect their dog)
- how to keep a medication log through travel
- a printable "medical summary for airline and quarantine staff"

- **Before building:** partner with Mighty Hearts Project or a veterinary cardiologist to review it, and present it as questions, never as medical advice.
- **Why:** it's the audience the site already serves, and nobody else has put this in one place.

### 9. Airline pet-policy guide for routes to Japan — L
Which airlines carry pets on routes to Japan, cabin vs. hold, size and weight limits, breed and health restrictions, and temperature embargoes. Every row gets a source link and a "last checked" date.
- **Why:** this is the second-biggest unknown after the paperwork, and it changes often, so it needs the same verify-and-date discipline as the country notes.

## Keep the information trustworthy over time

### 10. ⭐ Official-source change watcher — M
A scheduled job (GitHub Action or Claude routine) that fetches the key MAFF/AQS pages and each country's official pages every week and compares them with the last run. When something changes, it opens a GitHub issue with the diff.
- **Why:** rules changed in the middle of building this site (MAFF's retest rule, the EU's 2026 regulation, Chile's resolution). Today the site only finds out when someone re-researches by hand.

### 11. "Last verified" and sources shown on every country note — S
Show the source links and a verified date under each country note, which the research already has. Fade the badge to amber when a note is more than 6 months old.
- **Why:** it makes "double-check this" actionable, and it's honest about how fresh each fact is.

### 12. "Report a problem" on every item — S
A small link on each checklist item and country note that opens a pre-filled email or GitHub issue with the item id, country, language and page version.
- **Why:** the Facebook post asks people to report errors. This makes it a two-click job, and the reports arrive with everything needed to fix them.

### 13. Community experience reports — L
Moderated short reports such as "Narita, May 2026: AQS counter took 40 minutes, they asked for X", tagged by airport and origin country, submitted through a form and reviewed before publishing.
- **Why:** lived experience was the founding idea of the site, and other people's experience scales it. It also catches rule changes before official pages do.

## Reach more families

### 14. Cats, too — M
Japan's rules for cats are almost identical: same microchip, vaccinations, titer and 180-day wait. Add "dog or cat" as the first question and adjust the few differences (for example, the leptospirosis check applies only to dogs).
- **Why:** this roughly doubles the people it helps for little extra work. Every rule still needs checking against MAFF's own cat wording.

### 15. Native-speaker review and more languages — M (ongoing)
Recruit one native-speaker reviewer per language, especially from the communities already using the site, and show a "reviewed by a native speaker" badge once a language passes. Then add Korean, Portuguese, Italian, Traditional Chinese and Thai, which map to large groups of origin-country visitors.
- **Why:** the current translations are AI-made and machine-checked, but not yet human-reviewed. The tooling (hash-pinned strings, integrity checks, audit script) is already in place to make this safe.

## The trip around the trip

### 16. ⭐ Full return-home planner — M
Turn "coming home" into its own guided flow with deadlines:
- Japan's export inspection application (at least 14 days ahead via NACCS) and the 10-day inspection window
- the home country's import permit lead times (for example, Australia's BICON permit and Mickleham quarantine booking, or New Zealand's 30-working-day permit)
- all of it on the same timeline and calendar export

- **Why:** surgery trips are round trips, and the return leg has its own traps, such as booking quarantine 6–8 weeks ahead.

### 17. Arrival-day guide by airport — S
For Narita, Haneda, Kansai, Chubu and Fukuoka: where the AQS counter is, typical wait times, what to have in hand, and what happens if something's wrong.
- **Why:** it calms the most nerve-racking moment of the whole process. Facts come from official AQS pages; experience reports (#13) fill in the rest.

### 18. Staying longer in Japan — S
For stays beyond a short trip (surgery recovery can take weeks), research and add what Japan expects of dogs living there. For example, Japan's Rabies Prevention Act requires registering resident dogs with the local municipality and an annual rabies vaccination. Every rule needs verifying against official sources first.
- **Why:** these families don't know what they don't know.

### 19. Cost estimator — M
A per-country breakdown with ranges: endorsement fees, lab fees, vet visits, airline and crate costs, return-home permits and quarantine. The figures come from the official fee pages already found in research, each with a source and date.
- **Why:** budgeting is a real stress point. Many fees are already in the country notes; they just aren't added up.

## Make it work anywhere

### 20. Offline app plus a private share link — M
- **Offline:** make the site an installable offline app (it already has a web manifest), so the checklist, documents list and dates work at the airport with no signal.
- **Share link:** a "share with my partner or vet" link that carries the answers inside the link itself (compressed into the URL `#fragment`, which never reaches any server) and opens a read-only checklist.

- **Why:** coordination between partners, the vet and the export authority is constant. This keeps the site's no-account, no-server privacy promise.

## Get found (search follow-ups)

Added 2026-11-26, after the site went into Google Search Console and gained
real, indexable URLs: `/faq/`, `/story/`, `/from/` with 47 country guides,
each in all 9 languages with hreflang (about 460 pages, all in `sitemap.xml`).

### 21. ⭐ Human check of the five partly-verified countries — S
China, Israel, Saudi Arabia, South Africa and the UAE have country notes whose official sources blocked automated research (see `PROJECT-MEMORY.md`), so they are written more cautiously. They now have their own Google-indexed guide pages, so a person should check them against the official sites.
- **Why:** wrong advice on a search landing page reaches more people than a note buried in a checklist.

### 22. Add the site to Bing Webmaster Tools — S
Use "Import from Google Search Console", which copies the verification and the sitemap.
- **Why:** Bing's index also feeds DuckDuckGo, Yahoo and several AI search tools. It takes about five minutes.

### 23. Watch for country pages Google won't index — S, then ongoing
Around mid-December 2026, check Search Console → Indexing → Pages. The 47 guides share most of their text (Japan's side of the process is the same everywhere), and Google sometimes skips near-identical pages as "Crawled – currently not indexed".
- **Why:** if that happens, the fix is more country-specific content on each guide (local fees, lead times, lab locations), and items #11 and #19 would supply much of it.

### 24. Links from where people ask — ongoing
Share the matching country guide in expat, Japan-relocation and pet-travel forums, Reddit threads and Facebook groups, for example `port.dog/from/canada/?ref=reddit`. The `?ref=` tag shows up in GoatCounter.
- **Why:** links from relevant sites count for more in Google's ranking than anything left to change on the site itself.

---

## Suggested order

1. **Quick wins (S):** #1 calendar export, #12 report-a-problem, #11 verified dates, #3 date slider, #17 arrival guide.
2. **Highest impact:** #4 document checker, #16 return-home planner, #8 heart-dog module (with Mighty Hearts review), #10 change watcher.
3. **Growth:** #14 cats, #15 native review and new languages, #9 airline guide, #13 community reports.

Every item that adds a rule or fact goes through the same rules as today: an
official source, translations via `scripts/i18n.js`, and `npm test` plus
`node scripts/audit-site.js` clean before deploying.
