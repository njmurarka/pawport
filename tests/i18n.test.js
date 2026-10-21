// Translations: integrity of every data/i18n/*.json, the language picker,
// persistence, the stale-translation guard, and layout in every language.
// See js/i18n.js for the overlay format and scripts/i18n.js for tooling.

const fs = require('fs');
const path = require('path');
const { BASE, withBrowser, makeChecker, daysFromNow } = require('./helpers');
const I18N = require('../js/i18n.js');
const tools = require('../scripts/i18n.js');

const LANGS = I18N.LANGS.map((l) => l.code).filter((c) => c !== 'en');
const ANSWERS = {
  originCountry: 'CA', dogName: 'Miso', healthConditions: ['heart'], microchipDone: 'yes', rabiesDoses: '2+',
  lastRabiesDate: '2026-03-24', rabiesDuration: '3yr', favnDone: 'yes', favnDate: '2026-03-24',
  travelDateKnown: 'yes', travelDate: daysFromNow(20), aqsNotified: 'no', hasTransit: 'yes',
};

function overlay(lang) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'i18n', lang + '.json'), 'utf8')).strings;
}

async function newPageIn(browser, lang, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  if (lang !== 'en') await ctx.addCookies([{ name: 'portdog_lang', value: lang, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  return { ctx, page };
}

async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect();
      if (!r.width || (r.right <= vw + 1 && r.left >= -1)) continue;
      let a = e, clipped = false;
      while ((a = a.parentElement)) {
        if (getComputedStyle(a).overflowX !== 'visible') { const pr = a.getBoundingClientRect(); if (pr.right <= vw + 1 && pr.left >= -1) { clipped = true; break; } }
      }
      if (!clipped) bad.push(e.tagName + '.' + [...e.classList].join('.'));
    }
    return { sw: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 5) };
  });
}

async function run() {
  const { check, failures } = makeChecker();

  // ---------- 1. Every language file: complete, current, and intact ----------
  {
    const { report } = tools.check(LANGS);
    for (const lang of LANGS) {
      const r = report[lang];
      check(lang + ': every string translated (no missing keys)', r.missing.length === 0, r.missing.slice(0, 5).join(', '));
      check(lang + ': no stale translations (all match current English)', r.stale.length === 0, r.stale.slice(0, 5).join(', '));
      check(lang + ': no integrity errors (numbers, placeholders, tags, protected terms)', r.errors.length === 0,
        r.errors.slice(0, 3).map((e) => e.key + ': ' + e.errors.join('; ')).join(' | '));
      check(lang + ': no obsolete keys', r.extra.length === 0, r.extra.slice(0, 5).join(', '));
    }
    // The checker itself must catch a changed number — otherwise the checks above prove nothing.
    check('integrity checker catches a changed number', tools.integrityErrors('Wait 180 days.', 'Warten Sie 18 Tage.').length > 0);
    check('integrity checker catches a dropped protected term', tools.integrityErrors('Use Form AC.', 'Use the form.').length > 0);
    check('integrity checker accepts a decimal comma', tools.integrityErrors('0.5 IU/mL', '0,5 IU/mL').length === 0);
  }

  await withBrowser(async (browser) => {
    // ---------- 2. Each language renders, labels itself, and shows the AI notice ----------
    for (const lang of LANGS) {
      const ov = overlay(lang);
      const { ctx, page } = await newPageIn(browser, lang);
      await page.goto(BASE + '/#/home');
      await page.waitForSelector('.support-card');
      const htmlLang = await page.evaluate(() => document.documentElement.lang);
      check(lang + ': <html lang> set', htmlLang === (lang === 'zh' ? 'zh-Hans' : lang), 'got ' + htmlLang);
      const navHome = (await page.locator('.site-nav a[href="#/home"]').textContent()).trim();
      check(lang + ': nav is translated', navHome === ov['ui.nav.home'][1], 'got "' + navHome + '"');
      const h1 = (await page.locator('.hero h1').textContent()).trim();
      check(lang + ': home heading is translated', h1 === ov['ui.home.title'][1], 'got "' + h1 + '"');
      check(lang + ': AI-translation notice is shown', await page.locator('#langNotice').isVisible());
      const code = (await page.locator('#langCode').textContent()).trim();
      check(lang + ': language button shows its code', code === lang.toUpperCase(), 'got ' + code);
      await ctx.close();
    }

    // English: no notice, and English is the default with no cookie at all.
    {
      const { ctx, page } = await newPageIn(browser, 'en');
      await page.goto(BASE + '/#/home');
      await page.waitForSelector('.support-card');
      check('en: default language with no cookie', (await page.evaluate(() => document.documentElement.lang)) === 'en');
      check('en: no AI-translation notice', !(await page.locator('#langNotice').isVisible()));
      await ctx.close();
    }

    // ---------- 3. Picker: choose a language, it sticks across reloads, and back ----------
    {
      const { ctx, page } = await newPageIn(browser, 'en');
      await page.goto(BASE + '/#/home');
      await page.waitForSelector('.support-card');
      await page.click('#langBtn');
      const opts = page.locator('#langMenu .lang-option');
      check('picker lists all 9 languages', (await opts.count()) === 9, 'count=' + (await opts.count()));
      const flags = await page.locator('#langMenu .lang-option img').evaluateAll((imgs) => imgs.map((i) => i.naturalWidth > 0 || i.getAttribute('src')));
      check('every option has a flag image', flags.length === 9 && flags.every(Boolean));
      await Promise.all([page.waitForNavigation(), opts.filter({ hasText: 'Deutsch' }).click()]);
      await page.waitForSelector('.support-card');
      check('choosing Deutsch switches to German', (await page.evaluate(() => document.documentElement.lang)) === 'de');
      const cookies = await ctx.cookies();
      check('choice is remembered in a cookie', cookies.some((c) => c.name === 'portdog_lang' && c.value === 'de'));
      await page.reload();
      await page.waitForSelector('.support-card');
      check('choice survives a reload', (await page.evaluate(() => document.documentElement.lang)) === 'de');
      await Promise.all([page.waitForNavigation(), page.click('#btnReadEnglish')]);
      await page.waitForSelector('.support-card');
      check('"Read in English" switches back', (await page.evaluate(() => document.documentElement.lang)) === 'en');
      await page.click('#langBtn');
      await page.keyboard.press('Escape');
      check('Escape closes the language menu', await page.locator('#langMenu').isHidden());
      await ctx.close();
    }

    // ---------- 4. Stale guard: edited English beats an outdated translation ----------
    {
      const { ctx, page } = await newPageIn(browser, 'de');
      const changed = 'CHANGED ENGLISH HEADING — translation must not be used';
      await page.route('**/data/checklist-data.json*', async (route) => {
        const res = await route.fetch();
        const data = await res.json();
        data.ui['home.title'] = changed;
        await route.fulfill({ response: res, json: data });
      });
      await page.goto(BASE + '/#/home');
      await page.waitForSelector('.support-card');
      const h1 = (await page.locator('.hero h1').textContent()).trim();
      check('a translation whose English changed falls back to the new English', h1 === changed, 'got "' + h1 + '"');
      const nav = (await page.locator('.site-nav a[href="#/home"]').textContent()).trim();
      check('…while unchanged strings stay translated', nav === overlay('de')['ui.nav.home'][1], 'got "' + nav + '"');
      await ctx.close();
    }

    // ---------- 5. Same answers -> same checklist in every language ----------
    {
      async function itemIds(lang) {
        const { ctx, page } = await newPageIn(browser, lang);
        await page.goto(BASE + '/#/home');
        await page.evaluate((a) => localStorage.setItem('pawport_answers_v1', JSON.stringify(a)), ANSWERS);
        await page.goto(BASE + '/#/results');
        await page.waitForSelector('.results-header');
        const ids = await page.locator('.checklist-item').evaluateAll((els) => els.map((e) => e.dataset.itemId));
        const alerts = await page.locator('.feasibility-alert').count();
        await ctx.close();
        return ids.join(',') + '|alerts=' + alerts;
      }
      const en = await itemIds('en');
      for (const lang of LANGS) {
        check(lang + ': same checklist items and alerts as English', (await itemIds(lang)) === en);
      }
    }

    // ---------- 6. No horizontal overflow in any language, phone to desktop ----------
    for (const lang of LANGS) {
      for (const w of [320, 390, 1024, 1440]) {
        const { ctx, page } = await newPageIn(browser, lang, { width: w, height: 900 });
        await page.goto(BASE + '/#/home');
        await page.evaluate((a) => localStorage.setItem('pawport_answers_v1', JSON.stringify(a)), ANSWERS);
        for (const [route, sel] of [['home', '.support-card'], ['wizard', '.card'], ['results', '.results-header'], ['resources', 'h1'], ['about', '.story-banner']]) {
          await page.goto(BASE + '/#/' + route);
          await page.waitForSelector(sel);
          await page.waitForTimeout(120);
          const o = await horizontalOverflow(page);
          check(lang + ' #/' + route + ' at ' + w + 'px: no horizontal overflow', o.sw <= o.vw && o.bad.length === 0, JSON.stringify(o));
        }
        // Inline nav (when shown) must stay on one line.
        const wrapped = await page.locator('.site-nav > a').evaluateAll((els) => els.filter((e) => getComputedStyle(e.parentElement).position !== 'absolute' && e.getClientRects().length > 1).length);
        check(lang + ' at ' + w + 'px: nav links never wrap', wrapped === 0, 'wrapped=' + wrapped);
        await ctx.close();
      }
    }
  });

  console.log('\n=== i18n.test.js SUMMARY ===');
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
