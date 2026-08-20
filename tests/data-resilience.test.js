// Proves the app survives its OWN future evolution: a JSON export from an
// older or newer version of the app, a hand-edited file, or localStorage
// left over from before an update must never crash the app or leave
// garbage on screen. Exercises the real import-modal UI (paste + import),
// not just injected localStorage, since sanitizeAnswers/sanitizeChecked/
// migrateAnswers in js/app.js are what's actually under test.
//
// Reordering DATA.wizard is NOT separately runtime-tested here: it's
// architecturally guaranteed instead, by inspection — every lookup in
// getVisibleSteps/matches/isAnswered/sanitizeAnswers is keyed by question
// id (answers[q.id]), never by array position, so changing the array's
// order cannot change behavior. Simulating a reordered data file would
// mean mutating the real data/checklist-data.json mid-test-run for
// marginal extra confidence over what's already true by construction.

const { BASE, fmtISO, withBrowser, makeChecker, goToResults } = require('./helpers');

async function openImportAndPaste(page, jsonText) {
  await page.goto(BASE + '/#/results');
  // may be on the "no answers yet" empty state or a real results page —
  // both have an import entry point.
  const importBtn = page.locator('#btnImportEmpty, #btnImport');
  await importBtn.first().click();
  await page.waitForSelector('#importTextarea');
  await page.fill('#importTextarea', jsonText);
  await page.locator('#btnImportPasted').click();
}

async function run() {
  const { check, failures } = makeChecker();

  await withBrowser(async (browser) => {
    // 1. Obsolete field (no longer exists) + invalid option values -> sanitized away, no crash.
    {
      const page = await browser.newPage();
      const payload = {
        pawportExport: true, version: 1, exportedAt: new Date(0).toISOString(),
        answers: {
          originCountry: 'CA',
          thisFieldNoLongerExists: 'garbage-from-an-old-version',
          healthConditions: ['none'],
          microchipDone: 'yes',
          rabiesDoses: 'five', // not a valid option value anymore/ever
          hasTransit: 'no',
        },
        checked: { 'an-obsolete-checklist-item-id': true },
      };
      await openImportAndPaste(page, JSON.stringify(payload));
      // The modal auto-closes ~500ms after a successful import, so read
      // the status text quickly, before that timer fires.
      const status = await page.locator('#importStatus').textContent().catch(() => '');
      check('Import with obsolete field + invalid option value succeeds without error', /imported/i.test(status), 'status=' + status);
      await page.waitForTimeout(700);
      const label = await page.locator('.question-label').textContent().catch(() => null);
      // Either lands on results (if enough was salvaged) or resumes the wizard on a real question — either way, no crash and no blank/garbage screen.
      const resultsVisible = await page.locator('.results-header').count();
      const wizardVisible = label !== null;
      check('App renders a real screen after importing garbage (not blank/broken)', resultsVisible > 0 || wizardVisible, 'resultsVisible=' + resultsVisible + ' wizardVisible=' + wizardVisible);
      await page.close();
    }

    // 2. Missing fields that exist in the CURRENT schema (simulates an export from before a question existed, e.g. aqsNotified) -> wizard just asks them again, no crash.
    {
      const page = await browser.newPage();
      const payload = {
        pawportExport: true, version: 1, exportedAt: new Date(0).toISOString(),
        answers: {
          originCountry: 'CA', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
          favnDone: 'yes', favnDate: fmtISO(new Date(Date.now() - 200 * 86400000)),
          travelDateKnown: 'yes', travelDate: fmtISO(new Date(Date.now() + 60 * 86400000)),
          // aqsNotified / aqsNotifiedDate deliberately absent — as if exported before that question existed
          hasTransit: 'no',
        },
        checked: {},
      };
      await openImportAndPaste(page, JSON.stringify(payload));
      await page.waitForTimeout(600);
      await page.goto(BASE + '/#/wizard');
      const label = await page.locator('.question-label').textContent().catch(() => '');
      check('Missing a newer required field -> wizard resumes by asking exactly that question', /Animal Quarantine Service/i.test(label), 'landed on: ' + label);
      await page.close();
    }

    // 3. Completely garbage import (no "answers" key at all) -> friendly error, not a crash.
    {
      const page = await browser.newPage();
      await openImportAndPaste(page, JSON.stringify({ foo: 'bar' }));
      await page.waitForTimeout(300);
      const status = await page.locator('#importStatus').textContent().catch(() => '');
      check('Garbage import (no answers key) shows a friendly error, not a crash', /couldn.t import/i.test(status), 'status=' + status);
      await page.close();
    }

    // 4. Malformed JSON text entirely -> friendly parse error, not a crash.
    {
      const page = await browser.newPage();
      await openImportAndPaste(page, '{ this is not valid json ]');
      await page.waitForTimeout(300);
      const status = await page.locator('#importStatus').textContent().catch(() => '');
      check('Malformed JSON text shows a friendly parse error, not a crash', /couldn.t import/i.test(status), 'status=' + status);
      await page.close();
    }

    // 5. localStorage itself (not import) holding obsolete + invalid data, simulating an app UPDATE landing under a returning visitor -> self-heals on next load, valid answers are KEPT.
    {
      const page = await browser.newPage();
      await page.goto(BASE + '/#/home');
      await page.evaluate(() => {
        localStorage.setItem('pawport_answers_v1', JSON.stringify({
          originCountry: 'CA',                 // valid, must survive
          dogName: 'Miso',                     // valid, must survive
          healthConditions: ['none'],          // valid, must survive
          microchipDone: 'yes',                // valid, must survive
          rabiesDoses: 'not-a-real-option',    // invalid, must be dropped
          originCountryOld: 'JP',              // obsolete field, must be dropped
        }));
        localStorage.setItem('pawport_checked_v1', JSON.stringify({ 'some-removed-item-id': true, 'confirm-microchip': true }));
      });
      await page.goto(BASE + '/index.html#/results');
      await page.waitForSelector('.results-header, .card');
      const dogLabel = await page.locator('.results-header h1').textContent().catch(() => '');
      check('Valid answers survive a schema self-heal (dog name shown)', /Miso/.test(dogLabel), 'heading=' + dogLabel);
      await page.close();
    }
  });

  console.log('\n=== data-resilience.test.js SUMMARY ===');
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
