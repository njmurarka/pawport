// Consolidated regression coverage for fixes made across this project's
// history: the dark/light theme toggle, the header-width layout bug it
// caused, and the build-info footer's fallback-when-rate-limited fix.

const { chromium } = require('playwright');
const { BASE, withBrowser, makeChecker, goToResults, setAnswers, daysFromNow } = require('./helpers');

async function run() {
  const { check, failures } = makeChecker();

  await withBrowser(async (browser) => {
    // ---------- Theme toggle ----------
    {
      const page = await browser.newPage();
      await page.goto(BASE + '/#/home');
      const initial = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      check('Default theme is light', initial === 'light', 'got: ' + initial);

      await page.locator('#themeToggle').click();
      const afterClick = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      check('Clicking toggle switches to dark', afterClick === 'dark', 'got: ' + afterClick);

      const cookie = await page.evaluate(() => document.cookie);
      check('Theme cookie is set to dark', /pawport_theme=dark/.test(cookie), 'cookie=' + cookie);

      await page.reload();
      const afterReload = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      check('Dark theme persists across reload via cookie', afterReload === 'dark', 'got: ' + afterReload);
      await page.close();
    }

    // Fresh-visit (context-level cookie) no-flash check needs a genuinely
    // fresh navigation, not a hash-only one on an already-loaded page.
    {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'pawport_theme', value: 'dark', domain: 'localhost', path: '/' }]);
      const page = await context.newPage();
      await page.goto(BASE + '/index.html#/home');
      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      check('Fresh visit with dark cookie already set -> dark theme before first paint (no flash)', theme === 'dark', 'got: ' + theme);
      await page.close();
    }

    // ---------- Header layout across widths (the toggle-caused wrapping regression) ----------
    {
      for (const w of [721, 800, 900, 901, 1024, 1180, 1440]) {
        const page = await browser.newPage({ viewport: { width: w, height: 120 } });
        await page.goto(BASE + '/#/home', { waitUntil: 'networkidle' });
        await page.waitForTimeout(250);
        const navVisible = await page.locator('.site-nav').isVisible();
        if (navVisible) {
          // Compare each link's rendered height against its OWN natural
          // single-line height (padding included) rather than one flat
          // threshold — .nav-cta is a padded pill button and is taller
          // than plain text links even when NOT wrapped, so a shared
          // cutoff produces false positives on it.
          const results = await page.locator('.site-nav > a').evaluateAll((els) =>
            els.map((e) => {
              const cs = getComputedStyle(e);
              const paddingV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
              const singleLine = parseFloat(cs.lineHeight) + paddingV;
              return { text: e.textContent.trim(), height: e.getBoundingClientRect().height, singleLine };
            })
          );
          const wrapped = results.filter((r) => r.height > r.singleLine + 4); // small tolerance for rounding
          check('Header width ' + w + 'px: nav links do not wrap (single line)', wrapped.length === 0, JSON.stringify(wrapped));
        }
        await page.close();
      }
    }

    // ---------- Heading "Japan" accent is a solid color, not a gradient sweep ----------
    // Regression for a real bug (twice): background-clip:text gradients
    // swept across arbitrary heading text put whichever word landed near
    // the gradient's midpoint into the muddy, desaturated RGB-interpolation
    // zone between orange and teal -- and that word was reliably "Japan"
    // (short results heading) or landed near it (longer hero heading),
    // rendering as dull khaki instead of a color. No amount of gradient-stop
    // tuning reliably fixes this for arbitrary text/viewport/wrapping, so
    // "Japan" now gets its own solid .accent-word color instead -- solid
    // colors can't blend into mud. Check both headings, both themes.
    {
      for (const theme of ['light', 'dark']) {
        const context = theme === 'dark'
          ? await (async () => { const c = await browser.newContext(); await c.addCookies([{ name: 'pawport_theme', value: 'dark', domain: 'localhost', path: '/' }]); return c; })()
          : await browser.newContext();
        const page = await context.newPage();

        await page.goto(BASE + '/index.html#/home');
        let accent = await page.locator('.hero h1 .accent-word').evaluate((el) => getComputedStyle(el).color);
        let rest = await page.locator('.hero h1').evaluate((el) => getComputedStyle(el).color);
        check(theme + ': home hero "Japan" is a distinct solid color from the rest of the heading', accent !== rest, 'accent=' + accent + ' rest=' + rest);
        check(theme + ': home hero "Japan" color is fully opaque (solid, not a transparent gradient-clip)', !accent.includes('0, 0, 0, 0)') , 'accent=' + accent);

        await setAnswers(page, {
          originCountry: 'DE', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
          favnDone: 'no', travelDateKnown: 'no', hasTransit: 'no',
        });
        await goToResults(page);
        accent = await page.locator('.results-header h1 .accent-word').evaluate((el) => getComputedStyle(el).color);
        rest = await page.locator('.results-header h1').evaluate((el) => getComputedStyle(el).color);
        check(theme + ': results heading "Japan" is a distinct solid color from the rest of the heading', accent !== rest, 'accent=' + accent + ' rest=' + rest);
        check(theme + ': results heading "Japan" color is fully opaque (solid, not a transparent gradient-clip)', !accent.includes('0, 0, 0, 0)'), 'accent=' + accent);

        await page.close();
      }
    }

    // ---------- "Start over" button on every wizard question ----------
    {
      const page = await browser.newPage();
      await page.goto(BASE + '/#/wizard');
      await page.selectOption('#fieldInput', 'CA');
      await page.locator('#btnNext').click();
      await page.locator('#btnSkip').click(); // now on dogBreed (question 3)

      // Cancelling the confirm must leave everything untouched.
      page.once('dialog', (d) => d.dismiss());
      await page.locator('#btnStartOver').click();
      await page.waitForTimeout(150);
      let label = await page.locator('.question-label').textContent();
      let stored = await page.evaluate(() => localStorage.getItem('pawport_answers_v1'));
      check('Start-over present on a non-first question', label.includes('breed'), 'got: ' + label);
      check('Cancelling the Start Over confirm leaves answers untouched', stored !== null, 'stored=' + stored);

      // Accepting it must clear storage and reset to question 1.
      page.once('dialog', (d) => d.accept());
      await page.locator('#btnStartOver').click();
      await page.waitForTimeout(150);
      label = await page.locator('.question-label').textContent();
      stored = await page.evaluate(() => localStorage.getItem('pawport_answers_v1'));
      check('Accepting Start Over resets to the first question', label.includes('country'), 'got: ' + label);
      check('Accepting Start Over clears stored answers', stored === null, 'stored=' + stored);
      await page.close();
    }

    // ---------- "Why is this asked?" help popup ----------
    {
      const page = await browser.newPage();
      await page.goto(BASE + '/#/wizard');
      await page.waitForSelector('#btnWhy');
      await page.locator('#btnWhy').click();
      await page.waitForSelector('.modal-card');
      const title = await page.locator('.modal-header h3').textContent();
      const body = await page.locator('.modal-body p').textContent();
      check('Why-button opens a modal titled "Why we ask this"', title === 'Why we ask this', 'got: ' + title);
      check('Why-button modal has non-trivial explanatory content', body.trim().length > 40, 'len=' + body.trim().length);
      await page.locator('.modal-close').click();
      const stillOpen = await page.locator('.modal-card').count();
      check('Why-button modal closes via the close button', stillOpen === 0, 'count=' + stillOpen);
      await page.close();
    }

    // ---------- "Returning Home" category (outbound + return leg content) ----------
    {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'CA', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        favnDone: 'yes', favnDate: daysFromNow(-200), travelDateKnown: 'no', hasTransit: 'no',
      });
      await goToResults(page);
      const japanExportItem = await page.locator('.checklist-item', { hasText: "Apply for Japan's own export inspection" }).count();
      const returnHomeItem = await page.locator('.checklist-item', { hasText: 'bring your dog back from Japan' }).count();
      check('Japan export-inspection item always shows', japanExportItem === 1, 'count=' + japanExportItem);
      check('Return-import-home item always shows', returnHomeItem === 1, 'count=' + returnHomeItem);
      const returnBody = await page.locator('.checklist-item', { hasText: 'bring your dog back from Japan' }).locator('.item-body').innerText();
      check('Return-import-home item shows Canada-specific note, not the generic default', !returnBody.includes('often the same body that handles exports'), 'body=' + returnBody.slice(0, 160));
      await page.close();
    }
    {
      // A country with no researched countryDetails entry must fall back to the generic default text, not break.
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'OTHER', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        favnDone: 'yes', favnDate: daysFromNow(-200), travelDateKnown: 'no', hasTransit: 'no',
      });
      await goToResults(page);
      const returnBody = await page.locator('.checklist-item', { hasText: 'bring your dog back from Japan' }).locator('.item-body').innerText();
      check('Unresearched country falls back to generic return-import-home guidance without breaking', returnBody.toLowerCase().includes('import authority'), 'body=' + returnBody.slice(0, 160));
      await page.close();
    }

    // ---------- Build-info footer fallback ----------
    {
      const page = await browser.newPage();
      await page.route('https://api.github.com/**', (route) => route.abort());
      await page.goto(BASE + '/#/home', { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const publishedText = await page.locator('#publishedAt').textContent();
      const hashText = await page.locator('#buildHashLink').textContent();
      check('Build-info footer never shows a bare placeholder when the GitHub API is unreachable', publishedText.trim() !== '—' && publishedText.trim() !== '', 'got: "' + publishedText + '"');
      check('Build-info footer shows a commit hash link when the GitHub API is unreachable (fallback data)', hashText.trim().length > 0, 'got: "' + hashText + '"');
      await page.close();
    }

    {
      const page = await browser.newPage();
      await page.route('https://api.github.com/repos/njmurarka/pawport/commits/main', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sha: 'deadbeefcafe1234567890abcdef1234567890ab', commit: { committer: { date: '2026-09-01T12:00:00Z' } } }),
        })
      );
      await page.goto(BASE + '/#/home', { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const hashText = await page.locator('#buildHashLink').textContent();
      check('A successful live fetch overrides the fallback commit hash', hashText.trim() === 'deadbee', 'got: "' + hashText + '"');
      await page.close();
    }
  });

  console.log('\n=== regression.test.js SUMMARY ===');
  if (failures.length) {
    console.log('FAILURES:', failures.length);
    failures.forEach((f) => console.log(' -', f));
    process.exitCode = 1;
  } else {
    console.log('All checks passed.');
  }
}

module.exports = { run };
if (require.main === module) run();
