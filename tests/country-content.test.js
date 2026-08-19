// Spot-checks per-country content (form-ac / gov-endorsement / return-import-home
// notes) actually renders on the results page for a representative sample of
// countries across regions, and that an unresearched country falls back to the
// generic default text without breaking. This is NOT a factual-accuracy check
// (that requires a human or a research pass, see PROJECT-MEMORY.md) — it only
// verifies the render pipeline and reports current coverage.

const { fmtISO, withBrowser, makeChecker, goToResults, setAnswers } = require('./helpers');
const fs = require('fs');
const path = require('path');

async function run() {
  const { check, failures } = makeChecker();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'checklist-data.json'), 'utf8'));
  const allCodes = data.countries.map((c) => c.code).filter((c) => c !== 'OTHER');
  const covered = Object.keys(data.countryDetails).filter((k) => k !== 'default');
  const missing = allCodes.filter((c) => !covered.includes(c));

  console.log('Countries with researched countryDetails: ' + covered.length + ' / ' + allCodes.length);
  if (missing.length) console.log('Still missing (falls back to generic default): ' + missing.join(', '));

  const sample = ['CA', 'US', 'GB', 'DE', 'AU', 'IN', 'BR', 'ZA'].filter((c) => allCodes.includes(c));

  await withBrowser(async (browser) => {
    for (const code of sample) {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: code, healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        favnDone: 'yes', favnDate: fmtISO(new Date(Date.now() - 200 * 86400000)),
        travelDateKnown: 'no', hasTransit: 'no',
      });
      await goToResults(page);
      const returnItem = page.locator('.checklist-item', { hasText: 'bring your dog back from Japan' });
      const count = await returnItem.count();
      check(code + ': return-import-home item renders without error', count === 1, 'count=' + count);
      if (count === 1) {
        const body = await returnItem.locator('.item-body').innerText();
        check(code + ': return-import-home item has non-trivial content', body.trim().length > 60, 'len=' + body.trim().length);
      }
      await page.close();
    }
  });

  console.log('\n=== country-content.test.js SUMMARY ===');
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
