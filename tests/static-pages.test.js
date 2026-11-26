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
  check('DATA.pages defines faq/ and story/', pages.map((p) => p.path).sort().join(',') === 'faq/,story/', JSON.stringify(pages));

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
    for (const [from, to] of [['/#/resources', '/faq/'], ['/#/about', '/story/'], ['/index.html#/resources', '/faq/'], ['/?lang=ja#/about', '/story/']]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(BASE + from);
      await page.waitForURL((u) => u.pathname === to, { timeout: 5000 }).catch(() => {});
      const u = new URL(page.url());
      check(from + ' forwards to ' + to, u.pathname === to, page.url());
      if (from.includes('lang=ja')) check(from + ' keeps ?lang=ja', u.search.includes('lang=ja'), page.url());
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

    // ---------- Another language: translated, English never shown first ----------
    {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'portdog_lang', value: 'ja', url: BASE }]);
      const page = await context.newPage();
      await page.goto(BASE + '/faq/', { waitUntil: 'commit' });
      await page.waitForSelector('main#app', { state: 'attached' });
      const hiddenFirst = await page.evaluate(() => {
        const m = document.getElementById('app');
        return !m.hasAttribute('data-prerendered') || getComputedStyle(m).visibility === 'hidden';
      });
      check('ja on faq/: pre-rendered English is hidden until translated', hiddenFirst);
      await page.waitForSelector('main#app:not([data-prerendered]) h1');
      const h1 = await page.locator('main h1').textContent();
      check('ja on faq/: page is shown in Japanese', h1 !== 'Resources & FAQ' && /[぀-ヿ一-龯]/.test(h1), h1);
      check('ja on faq/: content visible after translating', await page.evaluate(() => getComputedStyle(document.getElementById('app')).visibility === 'visible'));
      await context.close();
    }

    // ---------- Sitemap lists every page ----------
    {
      const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
      for (const p of ['', ...pages.map((x) => x.path)]) {
        check('sitemap.xml lists https://port.dog/' + p, sitemap.includes('<loc>https://port.dog/' + p + '</loc>'));
      }
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
