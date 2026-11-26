// The pre-rendered, search-engine-indexable content pages (faq/, story/ —
// see DATA.pages and scripts/build-pages.js): the committed files must be
// up to date, must carry their content and metadata without JavaScript,
// and must still behave like the app (old #/ links forward, language and
// navigation keep working).

const fs = require('fs');
const path = require('path');
const { BASE, withBrowser, makeChecker } = require('./helpers');
const { buildPages, loadPages } = require('../scripts/build-pages');

const ROOT = path.join(__dirname, '..');

async function run() {
  const { check, failures } = makeChecker();
  const pages = loadPages();
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/checklist-data.json'), 'utf8'));
  const realCountries = data.countries.filter((c) => c.code !== 'OTHER');
  check('DATA.pages defines faq/, story/ and from/', ['faq/', 'story/', 'from/'].every((x) => pages.some((p) => p.path === x)));
  check('Every real country has a guide page', realCountries.every((c) => pages.some((p) => p.path === 'from/' + c.slug + '/')), realCountries.filter((c) => !c.slug).map((c) => c.code).join(','));
  check('Country slugs are unique and URL-safe', new Set(realCountries.map((c) => c.slug)).size === realCountries.length && realCountries.every((c) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug)));
  check('"Other / not listed" gets no guide page', !data.countries.find((c) => c.code === 'OTHER').slug);

  await withBrowser(async (browser) => {
    // ---------- Committed files match a fresh build ----------
    {
      const built = await buildPages(browser, BASE);
      for (const r of built) {
        const committed = fs.readFileSync(path.join(ROOT, r.out), 'utf8');
        check(r.out + ' is up to date (else run: node scripts/build-pages.js)', committed === r.html);
      }
    }

    // ---------- Content and metadata are there without JavaScript ----------
    for (const [p, h1, sample] of [['faq/', 'Resources & FAQ', 'How does the FAVN blood test'], ['story/', 'Our story', 'How it started']]) {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(BASE + '/' + p);
      check(p + ' (no JS): has its <h1>', (await page.locator('main h1').first().textContent()) === h1);
      check(p + ' (no JS): has its content', (await page.locator('main').textContent()).includes(sample));
      check(p + ' (no JS): canonical is https://port.dog/' + p, (await page.locator('link[rel=canonical]').getAttribute('href')) === 'https://port.dog/' + p);
      check(p + ' (no JS): og:url matches canonical', (await page.locator('meta[property="og:url"]').getAttribute('content')) === 'https://port.dog/' + p);
      check(p + ' (no JS): own title', (await page.title()) === h1 + ' — port.dog');
      const desc = await page.locator('meta[name=description]').getAttribute('content');
      check(p + ' (no JS): own description', !!desc && !/^A free, personalized/.test(desc), desc);
      check(p + ' (no JS): exactly one <h1>', (await page.locator('h1').count()) === 1);
      check(p + ' (no JS): no home-page JSON-LD or noscript', (await page.locator('script[type="application/ld+json"], noscript').count()) === 0);
      check(p + ' (no JS): stylesheet resolves from the site root', await page.evaluate(() => getComputedStyle(document.querySelector('main')).paddingTop !== '0px'));
      await context.close();
    }

    // ---------- With JavaScript: same page, app takes over ----------
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE + '/faq/');
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      check('faq/: app renders the FAQ page there', (await page.locator('main h1').textContent()) === 'Resources & FAQ');
      check('faq/: nav marks Resources & FAQ active', (await page.locator('.site-nav a.active').getAttribute('href')) === 'faq/');
      check('faq/: page title kept', (await page.title()) === 'Resources & FAQ — port.dog');
      await page.click('.site-nav a.nav-cta');
      await page.waitForSelector('.wizard-progress, .card');
      check('faq/ → "Build my checklist" opens the wizard on the home page', new URL(page.url()).pathname === '/' && /#\/wizard$/.test(page.url()), page.url());
      check('Home page title is the site title again', (await page.title()).startsWith('port.dog —'));
      await page.click('.site-nav a[href="story/"]');
      await page.waitForSelector('main#app:not([data-prerendered]) .story-banner');
      check('Nav "Our story" goes to /story/', new URL(page.url()).pathname === '/story/', page.url());
      check('No script errors on the pre-rendered pages', errors.length === 0, errors.join(' | '));
      await page.close();
    }

    // ---------- Old #/ links forward to the real pages ----------
    for (const [from, to] of [['/#/resources', '/faq/'], ['/#/about', '/story/'], ['/index.html#/resources', '/faq/'], ['/?lang=ja#/about', '/ja/story/'], ['/faq/?lang=de&ref=x', '/de/faq/']]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(BASE + from);
      await page.waitForURL((u) => u.pathname === to, { timeout: 5000 }).catch(() => {});
      const u = new URL(page.url());
      check(from + ' forwards to ' + to, u.pathname === to, page.url());
      if (from.includes('ref=x')) check(from + ' keeps other query parameters, drops ?lang=', u.search === '?ref=x', page.url());
      await context.close();
    }

    // ---------- Home page links point at the real pages ----------
    {
      const page = await browser.newPage();
      await page.goto(BASE + '/#/home');
      await page.waitForSelector('.feature-grid');
      check('Home "browse the FAQ" button links to faq/', (await page.locator('.cta-row a.btn-secondary').getAttribute('href')) === 'faq/');
      check('Home story link links to story/', (await page.locator('.story-callout a').getAttribute('href')) === 'story/');
      check('Nav links to faq/ and story/', (await page.locator('.site-nav a[href="faq/"]').count()) === 1 && (await page.locator('.site-nav a[href="story/"]').count()) === 1);
      await page.close();
    }

    // ---------- Languages: each has its own URLs ----------
    {
      // Someone reading Japanese who opens an English page lands on its
      // Japanese URL, and never sees the English flash up first.
      const context = await browser.newContext();
      await context.addCookies([{ name: 'portdog_lang', value: 'ja', url: BASE }]);
      const page = await context.newPage();
      await page.goto(BASE + '/faq/', { waitUntil: 'commit' });
      await page.waitForSelector('main#app', { state: 'attached' });
      const hiddenFirst = await page.evaluate(() => location.pathname !== '/faq/' || getComputedStyle(document.getElementById('app')).visibility === 'hidden');
      check('ja visitor on /faq/: English content hidden until redirected', hiddenFirst);
      await page.waitForURL((u) => u.pathname === '/ja/faq/', { timeout: 5000 }).catch(() => {});
      check('ja visitor on /faq/ is sent to /ja/faq/', new URL(page.url()).pathname === '/ja/faq/', page.url());
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      const h1 = await page.locator('main h1').textContent();
      check('/ja/faq/: shown in Japanese', /[\u3040-\u30ff\u4e00-\u9faf]/.test(h1), h1);
      check('/ja/faq/: content visible', await page.evaluate(() => getComputedStyle(document.getElementById('app')).visibility === 'visible'));
      check('/ja/faq/: nav links stay in Japanese', (await page.locator('.site-nav a[data-page-path="story/"]').getAttribute('href')) === 'ja/story/');
      // Switching language on a page goes to that page in the new language.
      await page.click('#langBtn');
      await page.click('.lang-option[lang="de"]');
      await page.waitForURL((u) => u.pathname === '/de/faq/', { timeout: 5000 }).catch(() => {});
      check('Language menu on /ja/faq/ → German goes to /de/faq/', new URL(page.url()).pathname === '/de/faq/', page.url());
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      await page.click('#langBtn');
      await page.click('.lang-option[lang="en"]');
      await page.waitForURL((u) => u.pathname === '/faq/', { timeout: 5000 }).catch(() => {});
      check('Language menu on /de/faq/ → English goes to /faq/', new URL(page.url()).pathname === '/faq/', page.url());
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      check('…and stays in English there', (await page.locator('main h1').textContent()) === 'Resources & FAQ');
      await context.close();
    }
    {
      // A language URL wins over a different saved language, and is remembered.
      const context = await browser.newContext();
      await context.addCookies([{ name: 'portdog_lang', value: 'fr', url: BASE }]);
      const page = await context.newPage();
      await page.goto(BASE + '/es/from/germany/');
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      check('/es/from/germany/ with a French cookie stays Spanish', new URL(page.url()).pathname === '/es/from/germany/' && /Alemania/.test(await page.locator('main h1').textContent()));
      check('…and remembers Spanish', /portdog_lang=es/.test(await page.evaluate(() => document.cookie)));
      // The app (wizard) keeps that language; its links lead back to Spanish pages.
      await page.click('.guide-cta a.btn-primary');
      await page.waitForSelector('.card[data-question-id]');
      check('Guide CTA from /es/ opens the wizard in Spanish', (await page.evaluate(() => document.documentElement.lang)) === 'es');
      check('App nav links point to the Spanish pages', (await page.locator('.site-nav a[data-page-path="faq/"]').getAttribute('href')) === 'es/faq/');
      await context.close();
    }
    {
      // Language home pages (/ja/ …) are pre-rendered too and lead into the app.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(BASE + '/ja/');
      await page.waitForSelector('main#app:not([data-prerendered]) .feature-grid');
      check('/ja/: home page in Japanese', (await page.evaluate(() => document.documentElement.lang)) === 'ja' && /[\u3040-\u30ff\u4e00-\u9faf]/.test(await page.locator('main h1').textContent()));
      await page.click('.cta-row a.btn-primary');
      await page.waitForSelector('.card[data-question-id]');
      check('/ja/ "start" button opens the wizard in Japanese', new URL(page.url()).pathname === '/' && (await page.evaluate(() => document.documentElement.lang)) === 'ja', page.url());
      await context.close();
    }
    {
      // No JavaScript: a translated page carries its own language, text and links.
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(BASE + '/de/from/germany/');
      check('/de/from/germany/ (no JS): <html lang="de">', (await page.evaluate(() => document.documentElement.lang)) === 'de');
      check('/de/from/germany/ (no JS): German heading', /Deutschland/.test(await page.locator('main h1').textContent()));
      check('/de/from/germany/ (no JS): German nav text', (await page.locator('.site-nav a[data-page-path="faq/"]').textContent()) !== 'Resources & FAQ');
      check('/de/from/germany/ (no JS): German description', /Ausreiseland: Deutschland/.test(await page.locator('meta[name=description]').getAttribute('content')));
      check('/de/from/germany/ (no JS): canonical is itself', (await page.locator('link[rel=canonical]').getAttribute('href')) === 'https://port.dog/de/from/germany/');
      await context.close();
    }

    // ---------- hreflang: every page lists all 9 versions, reciprocally ----------
    {
      const LANGS = require('../scripts/build-pages').LANGS;
      const hl = (l) => (l === 'zh' ? 'zh-Hans' : l);
      const pre = (l) => (l === 'en' ? '' : l + '/');
      const read = (p) => fs.readFileSync(path.join(ROOT, p === '' ? 'index.html' : p + 'index.html'), 'utf8');
      const alternates = (html) => [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((m) => m[1] + ' ' + m[2]).sort();
      const bad = [];
      const basePaths = [''].concat([...new Set(pages.map((p) => p.basePath))].filter((b) => b !== ''));
      for (const b of basePaths) {
        const want = LANGS.map((l) => hl(l) + ' https://port.dog/' + pre(l) + b).concat('x-default https://port.dog/' + b).sort();
        for (const l of LANGS) {
          const html = read(pre(l) + b);
          if (JSON.stringify(alternates(html)) !== JSON.stringify(want)) bad.push(pre(l) + b);
          if (!html.includes('<link rel="canonical" href="https://port.dog/' + pre(l) + b + '">')) bad.push(pre(l) + b + ' (canonical)');
        }
      }
      check('All ' + basePaths.length * LANGS.length + ' pages (incl. index.html) list the same 9 languages + x-default and a self canonical', bad.length === 0, bad.slice(0, 5).join(', '));
    }

    // ---------- Sitemap lists every page ----------
    {
      const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
      const missing = ['', ...pages.map((x) => x.path)].filter((p) => !sitemap.includes('<loc>https://port.dog/' + p + '</loc>'));
      check('sitemap.xml lists the home page and all ' + pages.length + ' generated pages', missing.length === 0, missing.join(', '));
    }

    // ---------- Country guides ----------
    // The steps on a guide are the app's own checklist for a dog from that
    // country starting from scratch — so they must match the results page
    // for exactly those answers, item for item and in order.
    const SCRATCH = { microchipDone: 'no', rabiesDoses: '0', healthConditions: ['none'], hasTransit: 'no' };
    for (const code of ['GB', 'US', 'AU', 'US-HI', 'IL']) {
      const c = data.countries.find((x) => x.code === code);
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(BASE + '/#/home');
      await page.evaluate((a) => localStorage.setItem('pawport_answers_v1', JSON.stringify(a)), Object.assign({ originCountry: code }, SCRATCH));
      await page.goto(BASE + '/#/results');
      await page.waitForSelector('.results-header');
      const resultsTitles = await page.locator('.checklist-item .item-title').allTextContents();
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '/from/' + c.slug + '/');
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      const guideTitles = await page.locator('.guide-item .item-title').allTextContents();
      check(code + ' guide: same steps as the results page for a from-scratch dog', guideTitles.length > 5 && JSON.stringify(guideTitles) === JSON.stringify(resultsTitles), guideTitles.length + ' vs ' + resultsTitles.length);
      const lede = await page.locator('main .lede').textContent();
      check(code + ' guide: ' + (c.designated ? 'simplified' : 'full') + '-process intro', c.designated ? /designated rabies-free regions, so a simpler/.test(lede) : /doesn’t count .* designated/.test(lede), lede);
      check(code + ' guide: heading names the country naturally', (await page.locator('main h1').textContent()) === 'Bringing your dog to Japan from ' + (c.pageName || c.name));
      const noteCount = await page.locator('.guide-item strong', { hasText: 'Specific to ' + c.name }).count();
      check(code + ' guide: shows the country-specific notes', noteCount >= 2, noteCount);
      if (c.designated) check(code + ' guide: no FAVN step for a designated region', !guideTitles.some((tt) => /FAVN/.test(tt)));
      else check(code + ' guide: FAVN step present', guideTitles.some((tt) => /FAVN/.test(tt)));
      await context.close();
    }
    {
      // Designated regions: implanting the chip comes before confirming its number.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(BASE + '/from/australia/');
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      const titles = await page.locator('.guide-item .item-title').allTextContents();
      const implant = titles.findIndex((x) => /^Implant/.test(x));
      const confirm = titles.findIndex((x) => /^Confirm your microchip number/.test(x));
      check('AU guide: implant step comes before confirm-number step', implant !== -1 && confirm !== -1 && implant < confirm, titles.slice(0, 4).join(' | '));
      await context.close();
    }
    {
      // No-JS: the country page carries its own content and metadata.
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(BASE + '/from/germany/');
      check('from/germany/ (no JS): heading', (await page.locator('main h1').textContent()) === 'Bringing your dog to Japan from Germany');
      check('from/germany/ (no JS): Germany-specific note present', (await page.locator('main').textContent()).includes('Veterinäramt'));
      check('from/germany/ (no JS): canonical', (await page.locator('link[rel=canonical]').getAttribute('href')) === 'https://port.dog/from/germany/');
      const desc = await page.locator('meta[name=description]').getAttribute('content');
      check('from/germany/ (no JS): description names Germany', /from Germany/.test(desc), desc);
      await page.goto(BASE + '/from/hawaii/');
      const hdesc = await page.locator('meta[name=description]').getAttribute('content');
      check('from/hawaii/ (no JS): designated-region description', /designated rabies-free/.test(hdesc) && !/FAVN/.test(hdesc), hdesc);
      await page.goto(BASE + '/from/');
      const links = await page.locator('main .country-list a').count();
      check('from/ (no JS): lists every country', links === realCountries.length, links + ' vs ' + realCountries.length);
      await context.close();
    }
    {
      // "Build my checklist" on a guide pre-selects that country in the wizard…
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(BASE + '/from/germany/');
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      await page.click('.guide-cta a.btn-primary');
      await page.waitForSelector('.card[data-question-id]');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pawport_answers_v1') || '{}'));
      check('Guide CTA pre-selects the country in the wizard', saved.originCountry === 'DE', JSON.stringify(saved));
      check('Guide CTA lands on the wizard with a clean URL', new URL(page.url()).hash === '#/wizard', page.url());
      // …but never overwrites a country someone already chose.
      await page.evaluate(() => localStorage.setItem('pawport_answers_v1', JSON.stringify({ originCountry: 'CA', dogName: 'Keep' })));
      await page.goto(BASE + '/from/australia/');
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      await page.click('.guide-cta a.btn-primary');
      await page.waitForSelector('.card[data-question-id]');
      const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('pawport_answers_v1') || '{}'));
      check('Guide CTA never overwrites saved answers', kept.originCountry === 'CA' && kept.dogName === 'Keep', JSON.stringify(kept));
      await context.close();
    }
    {
      // Footer links to the country index on every page; Japanese guide is translated.
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(BASE + '/#/home');
      await page.waitForSelector('.feature-grid');
      check('Footer links to the country guides', (await page.locator('.site-footer a[href="from/"]').count()) === 1);
      await context.addCookies([{ name: 'portdog_lang', value: 'ja', url: BASE }]);
      await page.goto(BASE + '/ja/from/germany/');
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      const h1 = await page.locator('main h1').textContent();
      check('/ja/from/germany/: translated heading with the Japanese country name', /ドイツ/.test(h1) && !/Bringing/.test(h1), h1);
      await context.close();
    }
  });

  console.log('\n=== static-pages.test.js SUMMARY ===');
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
