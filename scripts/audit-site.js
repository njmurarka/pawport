// Full-site audit: every page, wizard step and popup, in every language.
// Usage: node scripts/audit-site.js [screenshot-dir] [langs, e.g. de,ja]
//        WIDTHS=nav node scripts/audit-site.js   (1180-1440px menu check)
// Flags English left untranslated, raw keys, unfilled placeholders, broken
// images, empty headings, horizontal overflow, hidden desktop menu, JS errors.
const h = require('../tests/helpers');
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const ROOT = require('path').join(__dirname, '..') + '/';
const I18N = require(ROOT + 'js/i18n.js');
const tools = require(ROOT + 'scripts/i18n.js');
const SRC = tools.loadEnglish();
const LANGS = (process.argv[3] || 'en,zh,hi,es,fr,de,ja,ru,nl').split(',');

const CA = { originCountry: 'CA', dogName: 'Miso', healthConditions: ['heart'], microchipDone: 'yes', rabiesDoses: '2+', lastRabiesDate: '2026-03-24', rabiesDuration: '3yr', favnDone: 'yes', favnDate: '2026-03-24', travelDateKnown: 'yes', travelDate: h.daysFromNow(20), aqsNotified: 'no', hasTransit: 'yes' };
const AU = { originCountry: 'AU', healthConditions: ['none'], microchipDone: 'no', travelDateKnown: 'no', hasTransit: 'yes' };

function leakSet(lang) {
  if (lang === 'en') return [];
  const ov = JSON.parse(fs.readFileSync(ROOT + 'data/i18n/' + lang + '.json', 'utf8')).strings;
  // English strings whose translation differs and that are long enough to be unambiguous.
  return Object.entries(SRC).filter(([k, en]) => !(ov[k] && ov[k][1] === en) && en.replace(/<[^>]+>/g, '').length >= 18)
    .map(([k, en]) => [k, en.replace(/<[^>]+>/g, '').replace(/\{\w+\}.*$/, '').trim()]).filter(([, t]) => t.length >= 18);
}

async function inspect(page, lang, label, leaks, problems, opts) {
  const r = await page.evaluate(({ leaks, checkNav }) => {
    const vw = document.documentElement.clientWidth;
    const out = { overflow: [], leak: [], keys: [], placeholders: [], images: [], emptyHeadings: [], nav: null };
    const text = document.body.innerText;
    for (const [k, t] of leaks) if (text.includes(t)) out.leak.push(k + ' :: ' + t.slice(0, 60));
    const keyRe = /\b(?:ui|home|wiz|results|alert|dates|nav|res|donate|maker|story|import|export|footer|header|lang|i18n|theme|error|meta)\.[a-zA-Z][\w.]*[a-zA-Z]\b/g;
    (text.match(keyRe) || []).forEach((m) => { if (!/^(?:port\.dog|nav\.)$/.test(m)) out.keys.push(m); });
    (text.match(/\{\w+\}/g) || []).forEach((m) => out.placeholders.push(m));
    for (const img of document.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if (r.width && img.complete && img.naturalWidth === 0) out.images.push(img.getAttribute('src'));
    }
    for (const hd of document.querySelectorAll('h1,h2,h3,h4,.item-title,.question-label,summary,dt')) {
      if (hd.getClientRects().length && !hd.textContent.trim()) out.emptyHeadings.push(hd.tagName + '.' + hd.className);
    }
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect();
      if (!r.width || (r.right <= vw + 1 && r.left >= -1)) continue;
      let a = e, clipped = false;
      while ((a = a.parentElement)) { if (getComputedStyle(a).overflowX !== 'visible') { const pr = a.getBoundingClientRect(); if (pr.right <= vw + 1 && pr.left >= -1) { clipped = true; break; } } }
      if (!clipped) out.overflow.push(e.tagName + '.' + [...e.classList].join('.'));
    }
    if (document.documentElement.scrollWidth > vw) out.overflow.push('document ' + document.documentElement.scrollWidth + '>' + vw);
    if (checkNav) {
      const nav = document.querySelector('.site-nav');
      out.nav = getComputedStyle(nav).display !== 'none' && !document.querySelector('.site-header').classList.contains('nav-compact');
    }
    return out;
  }, { leaks, checkNav: !!(opts && opts.checkNav) });
  const add = (kind, items) => { if (items && items.length) problems.push(lang + ' | ' + label + ' | ' + kind + ': ' + [...new Set(items)].slice(0, 6).join(' ;; ')); };
  add('ENGLISH LEFT IN', r.leak); add('RAW KEY', r.keys); add('UNFILLED PLACEHOLDER', r.placeholders);
  add('BROKEN IMAGE', r.images); add('EMPTY HEADING', r.emptyHeadings); add('OVERFLOW', r.overflow.slice(0, 4));
  if (opts && opts.checkNav && !r.nav) problems.push(lang + ' | ' + label + ' | NAV HIDDEN on desktop');
}

(async () => {
  await h.startServer();
  const b = await chromium.launch();
  const problems = [];
  const counts = {};
  for (const lang of LANGS) {
    const leaks = leakSet(lang);
    counts[lang] = 0;
    for (const [w, tag] of (process.env.WIDTHS === 'nav' ? [[1440, 'wide'], [1366, 'laptop'], [1180, 'small-laptop']] : [[1280, 'desk'], [390, 'phone']])) {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
      if (lang !== 'en') await ctx.addCookies([{ name: 'portdog_lang', value: lang, domain: 'localhost', path: '/' }]);
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      page.on('dialog', (d) => d.dismiss());
      const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${lang}-${tag}-${name}.png`, fullPage: true }); };
      const go = async (route, sel) => { await page.goto(h.BASE + '/#/' + route); await page.waitForSelector(sel); await page.waitForTimeout(200); };
      const check = async (label) => { counts[lang]++; await inspect(page, lang, tag + ' ' + label, leaks, problems, { checkNav: w >= 1180 }); };

      await go('home', '.support-card'); await check('home'); await shot('home');
      // popups from the home page
      for (const [btn, name] of [['#aboutBtn', 'about-popup'], ['[data-open-donate]', 'donate-popup'], ['#btnImportHome', 'import-popup']]) {
        if (w < 600 && btn === '#aboutBtn') { await page.click('#navToggle'); await page.click('.site-nav [data-open-about]'); }
        else await page.click(btn);
        await page.waitForSelector('.modal-card'); await check(name);
        if (w === 1280 && OUT) await page.screenshot({ path: `${OUT}/${lang}-${tag}-${name}.png` });
        await page.keyboard.press('Escape');
      }
      await page.click('#langBtn'); await page.waitForTimeout(150); await check('language-menu'); await page.keyboard.press('Escape');
      if (w < 600) { await page.click('#navToggle'); await page.waitForTimeout(150); await check('phone-menu'); if (OUT) await page.screenshot({ path: `${OUT}/${lang}-${tag}-menu.png` }); await page.click('#navToggle'); }

      // wizard: every question (Canada path asks all of them), plus each "why" popup
      await page.evaluate(() => localStorage.clear());
      await page.evaluate((a) => localStorage.setItem('pawport_answers_v1', JSON.stringify(a)), CA);
      await go('wizard', '.card');
      // jump to the first question
      for (let i = 0; i < 30; i++) { if (!(await page.locator('#btnBack').count())) break; const q = await page.locator('.progress-label span').first().textContent(); if (/^\D*1\D/.test(q.trim() + ' ')) break; await page.click('#btnBack'); await page.waitForTimeout(60); if (!(await page.locator('.card[data-question-id]').count())) { await go('wizard', '.card'); break; } }
      const seen = new Set();
      for (let i = 0; i < 30; i++) {
        const id = await page.locator('.card[data-question-id]').getAttribute('data-question-id');
        if (seen.has(id)) break;
        seen.add(id);
        await check('wizard:' + id);
        if (await page.locator('#btnWhy').count()) { await page.click('#btnWhy'); await page.waitForSelector('.modal-card'); await check('why:' + id); await page.keyboard.press('Escape'); }
        if (i === 4 && OUT) await page.screenshot({ path: `${OUT}/${lang}-${tag}-wizard.png`, fullPage: true });
        await page.click('#btnNext'); await page.waitForTimeout(80);
        if (!(await page.locator('.card[data-question-id]').count())) break;
      }
      counts[lang + ':wizardSteps'] = seen.size;

      for (const [name, ans] of [['results-CA', CA], ['results-AU', AU]]) {
        await page.evaluate((a) => localStorage.setItem('pawport_answers_v1', JSON.stringify(a)), ans);
        await page.goto(h.BASE + '/#/home'); await go('results', '.results-header'); await check(name); await shot(name);
      }
      await page.click('#btnExport'); await page.waitForSelector('.modal-card'); await check('export-popup'); await page.keyboard.press('Escape');
      await go('resources', 'h1');
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      await check('resources'); await shot('resources');
      await go('about', '.story-banner'); await check('story'); await shot('story');
      if (errs.length) problems.push(lang + ' | ' + tag + ' | JS ERRORS: ' + errs.join(' ;; '));
      await ctx.close();
    }
  }
  await b.close();
  console.log('checks run per language:', JSON.stringify(counts));
  console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS FOUND');
  process.exit(0);
})();
