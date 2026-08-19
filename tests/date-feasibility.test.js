// Exercises the date-math engine (computeAllDates / computeFeasibilityAlerts
// in js/app.js) directly via injected localStorage state — the wizard
// NAVIGATION correctness is covered separately in wizard-exhaustive.test.js,
// this focuses purely on whether the right blocker/urgent alerts fire for
// the right date combinations.

const { BASE, fmtISO, daysFromNow, withBrowser, makeChecker, setAnswers, goToResults } = require('./helpers');

async function run() {
  const { check, failures } = makeChecker();

  await withBrowser(async (browser) => {
    // 1. No FAVN yet, travel in 7 days -> blocker (the originally reported bug)
    {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'CA', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        lastRabiesDate: fmtISO(new Date(Date.now() - 60 * 86400000)), rabiesDuration: '3yr',
        favnDone: 'no', travelDateKnown: 'yes', travelDate: daysFromNow(7), hasTransit: 'no',
      });
      await goToResults(page);
      const blockers = await page.locator('.feasibility-alert.level-blocker').count();
      check('No FAVN yet + travel in 7 days -> blocker alert', blockers >= 1, 'count=' + blockers);
      await page.close();
    }

    // 2. FAVN done, travel before the 180-day wait is up -> blocker
    {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'CA', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        lastRabiesDate: fmtISO(new Date(Date.now() - 200 * 86400000)), rabiesDuration: '3yr',
        favnDone: 'yes', favnDate: fmtISO(new Date(Date.now() - 60 * 86400000)), // only 60 of 180 days elapsed
        travelDateKnown: 'yes', travelDate: daysFromNow(30), hasTransit: 'no',
      });
      await goToResults(page);
      const blockers = await page.locator('.feasibility-alert.level-blocker').count();
      check('FAVN drawn but 180-day wait not yet satisfied -> blocker', blockers >= 1, 'count=' + blockers);
      await page.close();
    }

    // 3. FAVN will have expired (2yr) before travel -> blocker
    {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'CA', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        lastRabiesDate: fmtISO(new Date(Date.now() - 100 * 86400000)), rabiesDuration: '3yr',
        favnDone: 'yes', favnDate: fmtISO(new Date(Date.now() - 100 * 86400000)),
        travelDateKnown: 'yes', travelDate: daysFromNow(800), // ~2.2 years out, past the 2-year FAVN validity
        hasTransit: 'no',
      });
      await goToResults(page);
      const blockers = await page.locator('.feasibility-alert.level-blocker').count();
      check('FAVN will have expired before travel date -> blocker', blockers >= 1, 'count=' + blockers);
      await page.close();
    }

    // 4. Rabies coverage will lapse before travel -> blocker
    {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'CA', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        lastRabiesDate: fmtISO(new Date(Date.now() - 300 * 86400000)), rabiesDuration: '1yr', // due in ~65 days
        favnDone: 'yes', favnDate: fmtISO(new Date(Date.now() - 300 * 86400000)),
        travelDateKnown: 'yes', travelDate: daysFromNow(120), // past the 1yr booster due date
        hasTransit: 'no',
      });
      await goToResults(page);
      const blockers = await page.locator('.feasibility-alert.level-blocker').count();
      check('Rabies coverage will lapse before travel date -> blocker', blockers >= 1, 'count=' + blockers);
      await page.close();
    }

    // 5. Rabies coverage has ALREADY lapsed (as of today) -> blocker
    {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'CA', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        lastRabiesDate: fmtISO(new Date(Date.now() - 400 * 86400000)), rabiesDuration: '1yr', // already expired
        favnDone: 'yes', favnDate: fmtISO(new Date(Date.now() - 400 * 86400000)),
        travelDateKnown: 'no', hasTransit: 'no',
      });
      await goToResults(page);
      const blockers = await page.locator('.feasibility-alert.level-blocker').count();
      check('Rabies coverage already lapsed -> blocker even with no travel date set', blockers >= 1, 'count=' + blockers);
      await page.close();
    }

    // 6. Travel within 40 days -> urgent AQS alert
    {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'CA', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        lastRabiesDate: fmtISO(new Date(Date.now() - 300 * 86400000)), rabiesDuration: '3yr',
        favnDone: 'yes', favnDate: fmtISO(new Date(Date.now() - 400 * 86400000)),
        travelDateKnown: 'yes', travelDate: daysFromNow(10), hasTransit: 'no',
      });
      await goToResults(page);
      const urgent = await page.locator('.feasibility-alert.level-urgent').count();
      check('Travel in 10 days (past 40-day AQS deadline) -> urgent alert', urgent >= 1, 'count=' + urgent);
      await page.close();
    }

    // 7. Designated region -> AQS urgent alert still applies (it's not FAVN-gated)
    {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'AU', healthConditions: ['none'], microchipDone: 'yes',
        travelDateKnown: 'yes', travelDate: daysFromNow(10), hasTransit: 'no',
      });
      await goToResults(page);
      const urgent = await page.locator('.feasibility-alert.level-urgent').count();
      const blockers = await page.locator('.feasibility-alert.level-blocker').count();
      check('Designated region, travel in 10 days -> urgent AQS alert still fires', urgent >= 1, 'count=' + urgent);
      check('Designated region -> never a FAVN-related blocker', blockers === 0, 'count=' + blockers);
      await page.close();
    }

    // 8. REGRESSION: fully valid, on-track flow -> zero alerts
    {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'CA', dogName: 'Miso', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        lastRabiesDate: fmtISO(new Date(Date.now() - 60 * 86400000)), rabiesDuration: '3yr',
        favnDone: 'yes', favnDate: fmtISO(new Date(Date.now() - 200 * 86400000)),
        travelDateKnown: 'yes', travelDate: daysFromNow(60), hasTransit: 'no',
      });
      await goToResults(page);
      const alerts = await page.locator('.feasibility-alert').count();
      check('REGRESSION: fully valid on-track flow -> zero alerts', alerts === 0, 'count=' + alerts);
      await page.close();
    }

    // 9. THE EXACT REPORTED BUG: travelDateKnown flipped to "no" with a stale travelDate left in storage -> zero alerts
    {
      const page = await browser.newPage();
      await setAnswers(page, {
        originCountry: 'CA', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
        lastRabiesDate: fmtISO(new Date(Date.now() - 60 * 86400000)), rabiesDuration: '3yr',
        favnDone: 'no',
        travelDateKnown: 'no', // user said "not yet" ...
        travelDate: daysFromNow(7), // ... but this stale value is still sitting in storage
        hasTransit: 'no',
      });
      await goToResults(page);
      const alerts = await page.locator('.feasibility-alert').count();
      check('travelDateKnown=no with a stale travelDate -> zero alerts (the exact reported bug)', alerts === 0, 'count=' + alerts);
      await page.close();
    }
  });

  console.log('\n=== date-feasibility.test.js SUMMARY ===');
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
