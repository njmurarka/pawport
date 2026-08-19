// Exhaustive structural audit of the wizard's decision tree.
//
// The wizard's conditional fields form a chain:
//   originCountry (-> designated) -> microchipDone -> rabiesDoses -> favnDone
//   travelDateKnown -> travelDate
// This walks the REAL wizard UI (not injected localStorage state) through
// every structurally-distinct combination of that chain, and for each one:
//   1. Asserts the exact sequence of question ids shown, in order — this is
//      the actual proof that no impossible/nonsensical question can ever be
//      reached, not just a spot check.
//   2. Asserts the resulting checklist matches an independent "what SHOULD
//      show" oracle built from the spec, not from the app's own code.
//   3. Uses uniformly "safe" dates throughout, so a real feasibility bug
//      can't hide behind a false-positive/negative from date math (that's
//      covered separately in date-feasibility.test.js) — every combo here
//      should produce ZERO feasibility alerts.
//
// It also replays specific "go back, change an earlier answer, continue"
// mutations through the real UI for every field with downstream
// dependents, and confirms the end state exactly matches a fresh walk of
// the new combo — this is the direct regression test for the two bugs
// reported live (travelDate and favnDate staleness).
//
// `designated` only ever matters as a boolean to wizard logic (which
// checklist items/questions show), never which specific country — so this
// uses one representative designated country (AU) and one non-designated
// country (CA) rather than all ~48. Per-country content (agency/forms
// text) is covered separately in country-content.test.js.

const { BASE, fmtISO, withBrowser, makeChecker } = require('./helpers');

const NON_DESIGNATED = 'CA';
const DESIGNATED = 'AU';

const SAFE_DATES = {
  lastRabiesDate: fmtISO(new Date(Date.now() - 60 * 86400000)),
  favnDate: fmtISO(new Date(Date.now() - 200 * 86400000)),
  travelDate: fmtISO(new Date(Date.now() + 300 * 86400000)),
};

function expectedIdsFor(combo) {
  const ids = ['originCountry', 'dogName', 'dogBreed', 'healthConditions', 'microchipDone'];
  if (!combo.designated && combo.microchipDone === 'yes') {
    ids.push('rabiesDoses');
    if (combo.rabiesDoses === '1' || combo.rabiesDoses === '2+') ids.push('lastRabiesDate', 'rabiesDuration');
    if (combo.rabiesDoses === '2+') {
      ids.push('favnDone');
      if (combo.favnDone === 'yes') ids.push('favnDate');
    }
  }
  ids.push('travelDateKnown');
  if (combo.travelDateKnown === 'yes') ids.push('travelDate');
  ids.push('hasTransit');
  return ids;
}

// Independent oracle: what the checklist SHOULD show, derived from the
// spec (MAFF rules + the app's own stated design), not from app.js.
function expectedItems(combo) {
  const rabiesDoses = combo.designated ? undefined : (combo.microchipDone === 'yes' ? combo.rabiesDoses : '0');
  const favnDone = combo.designated ? undefined : (rabiesDoses === '2+' ? combo.favnDone : 'no');
  const hasLastRabiesDate = rabiesDoses === '1' || rabiesDoses === '2+';
  return {
    'Implant an ISO-compliant microchip (if not already done)': !combo.designated && (combo.microchipDone === 'no' || combo.microchipDone === 'unsure'),
    'Complete two rabies vaccinations, at least 30 days apart': rabiesDoses === '0',
    'Complete the second rabies vaccination': rabiesDoses === '1',
    'inactivated (killed) or recombinant, not live': !combo.designated,
    'Get a FAVN (or RFFIT) antibody titer test': !combo.designated,
    'Wait out the 180-day clock': !combo.designated,
    "Know your FAVN's 2-year outer validity": !combo.designated,
    'plan a redraw with a small buffer': !combo.designated && favnDone === 'yes',
    "Set a booster reminder well before your vaccine's labeled expiry": !combo.designated && hasLastRabiesDate,
    'Implant an ISO-compliant microchip</span>': false, // placeholder unused; designated-microchip checked separately below
    'Confirm your dog meets the residency requirement': !!combo.designated,
    "current designated-region status directly with MAFF": !!combo.designated,
    "Check the separate pet rules for any country you'll pass through": combo.hasTransit === 'yes' || combo.hasTransit === 'unsure',
  };
}

function buildCombos() {
  const combos = [];
  for (const microchipDone of ['yes', 'no', 'unsure']) {
    for (const travelDateKnown of ['yes', 'no']) {
      for (const hasTransit of ['yes', 'no', 'unsure']) {
        combos.push({ designated: true, originCode: DESIGNATED, microchipDone, rabiesDoses: null, favnDone: null, travelDateKnown, hasTransit });
      }
    }
  }
  for (const microchipDone of ['no', 'unsure']) {
    for (const travelDateKnown of ['yes', 'no']) {
      for (const hasTransit of ['yes', 'no', 'unsure']) {
        combos.push({ designated: false, originCode: NON_DESIGNATED, microchipDone, rabiesDoses: null, favnDone: null, travelDateKnown, hasTransit });
      }
    }
  }
  for (const rabiesDoses of ['0', '1', 'unsure']) {
    for (const travelDateKnown of ['yes', 'no']) {
      for (const hasTransit of ['yes', 'no', 'unsure']) {
        combos.push({ designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses, favnDone: null, travelDateKnown, hasTransit });
      }
    }
  }
  for (const favnDone of ['yes', 'no', 'unsure']) {
    for (const travelDateKnown of ['yes', 'no']) {
      for (const hasTransit of ['yes', 'no', 'unsure']) {
        combos.push({ designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses: '2+', favnDone, travelDateKnown, hasTransit });
      }
    }
  }
  return combos;
}

async function currentQuestionId(page) {
  return page.locator('.card[data-question-id]').getAttribute('data-question-id');
}

async function answerField(page, id, combo) {
  switch (id) {
    case 'originCountry':
      await page.selectOption('#fieldInput', combo.originCode);
      break;
    case 'dogName':
    case 'dogBreed':
      await page.locator('#btnSkip').click();
      return; // skip click already advances
    case 'healthConditions': {
      // Checkbox, not radio — clicking an ALREADY-checked "exclusive"
      // option toggles it OFF (unlike a radio, which stays checked on
      // re-click). Mutation tests re-walk through questions answered
      // earlier, so this must be idempotent rather than a blind click.
      const noneOption = page.locator('.option-item', { hasText: 'None of the above' });
      const alreadyChecked = await noneOption.locator('input').isChecked();
      if (!alreadyChecked) await noneOption.click();
      break;
    }
    case 'microchipDone':
      await page.locator('.option-item', { hasText: combo.microchipDone === 'yes' ? /^Yes$/ : (combo.microchipDone === 'no' ? 'No, not yet' : /^Not sure$/) }).click();
      break;
    case 'rabiesDoses':
      await page.locator('.option-item', { hasText: { '0': 'None yet', '1': /^One$/, '2+': 'Two or more', unsure: /^Not sure$/ }[combo.rabiesDoses] }).click();
      break;
    case 'lastRabiesDate':
      await page.fill('#fieldInput', SAFE_DATES.lastRabiesDate);
      break;
    case 'rabiesDuration':
      await page.locator('.option-item', { hasText: '3 years' }).click();
      break;
    case 'favnDone':
      await page.locator('.option-item', { hasText: combo.favnDone === 'yes' ? /^Yes$/ : (combo.favnDone === 'no' ? 'No, not yet' : /^Not sure$/) }).click();
      break;
    case 'favnDate':
      await page.fill('#fieldInput', SAFE_DATES.favnDate);
      break;
    case 'travelDateKnown':
      await page.locator('.option-item', { hasText: combo.travelDateKnown === 'yes' ? /^Yes$/ : 'Not yet' }).click();
      break;
    case 'travelDate':
      await page.fill('#fieldInput', SAFE_DATES.travelDate);
      break;
    case 'hasTransit':
      await page.locator('.option-item', { hasText: { yes: /^Yes$/, no: 'No — direct route only', unsure: 'Not sure yet' }[combo.hasTransit] }).click();
      break;
  }
  await page.locator('#btnNext').click();
}

// Walks from the CURRENT wizard position through the given remaining ids,
// asserting sequence at every step. Used both for a fresh full walk and
// for the "rest of the path after a mutation" continuation.
async function walkFrom(page, remainingIds, combo, check, comboLabel) {
  for (const id of remainingIds) {
    const actual = await currentQuestionId(page);
    if (actual !== id) {
      check(comboLabel + ': expected question "' + id + '" but wizard showed "' + actual + '"', false);
      return false;
    }
    await answerField(page, id, combo);
  }
  return true;
}

async function assertResultsMatchCombo(page, combo, check, comboLabel) {
  // NOT '.results-header, .card' — '.card' is generic enough that it can
  // match the still-present WIZARD card an instant before the async
  // hashchange-triggered re-render swaps in the results page, making
  // waitForSelector return too early and the first few checks below lose
  // the race against the real render.
  await page.waitForSelector('.results-header');
  const alertCount = await page.locator('.feasibility-alert').count();
  check(comboLabel + ': no feasibility alerts (safe dates used)', alertCount === 0, 'count=' + alertCount);

  const expected = expectedItems(combo);
  for (const [text, shouldShow] of Object.entries(expected)) {
    if (text.endsWith('</span>')) continue; // unused placeholder entry
    const count = await page.locator('.checklist-item', { hasText: text }).count();
    const actualShows = count > 0;
    if (actualShows !== shouldShow) {
      check(comboLabel + ': item "' + text.slice(0, 40) + '" expected ' + shouldShow + ' but got ' + actualShows, false);
    }
  }
  // designated-microchip item checked separately (title collides with the non-designated "microchip" item's prefix)
  const designatedMicrochipCount = await page.locator('.checklist-item .item-title', { hasText: /^Implant an ISO-compliant microchip$/ }).count();
  const shouldShowDesignatedMicrochip = !!combo.designated && (combo.microchipDone === 'no' || combo.microchipDone === 'unsure');
  if ((designatedMicrochipCount > 0) !== shouldShowDesignatedMicrochip) {
    check(comboLabel + ': designated-microchip item expected ' + shouldShowDesignatedMicrochip + ' but got ' + (designatedMicrochipCount > 0), false);
  }
}

async function fullWalk(page, combo, check) {
  const label = 'combo(' + JSON.stringify(combo) + ')';
  // Fresh start every time: the wizard correctly RESUMES at the last
  // step when everything's already answered (that's the resume-progress
  // feature working as intended) — a test that wants a clean walk must
  // explicitly clear prior state, or it inherits the previous combo's
  // answers instead of starting over.
  await page.goto(BASE + '/#/home');
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/#/wizard');
  const ids = expectedIdsFor(combo);
  const ok = await walkFrom(page, ids, combo, check, label);
  if (!ok) return;
  await assertResultsMatchCombo(page, combo, check, label);
}

async function runExhaustiveCombos(browser, check) {
  const combos = buildCombos();
  let failuresBefore = check.failures ? check.failures.length : 0;
  const page = await browser.newPage();
  for (const combo of combos) {
    await fullWalk(page, combo, check);
  }
  await page.close();
  console.log('Exhaustive structural combos run: ' + combos.length);
}

// "Go back and change an earlier answer, then continue" — for every field
// with downstream dependents, replayed through the real UI end to end.
async function runMutationTests(browser, check) {
  const page = await browser.newPage();

  async function mutateAndVerify(label, fromCombo, mutateAtId, toCombo) {
    await fullWalk(page, fromCombo, check); // establishes the "before" state for real, including localStorage
    await page.goto(BASE + '/#/wizard'); // resumes at the end since everything's answered
    // click Back until we reach the field to mutate
    for (let i = 0; i < 15; i++) {
      const id = await currentQuestionId(page);
      if (id === mutateAtId) break;
      await page.locator('#btnBack').click();
    }
    const landedOn = await currentQuestionId(page);
    check(label + ': back-navigated to "' + mutateAtId + '"', landedOn === mutateAtId, 'landed on ' + landedOn);

    const toIds = expectedIdsFor(toCombo);
    const mutateIdx = toIds.indexOf(mutateAtId);
    const ok = await walkFrom(page, toIds.slice(mutateIdx), toCombo, check, label + ' (post-mutation)');
    if (!ok) return;
    await assertResultsMatchCombo(page, toCombo, check, label + ' (post-mutation)');
  }

  // 1. THE EXACT REPORTED BUG: had a travel date, changed mind to "not yet".
  await mutateAndVerify(
    'travelDateKnown yes->no',
    { designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses: '2+', favnDone: 'no', travelDateKnown: 'yes', hasTransit: 'no' },
    'travelDateKnown',
    { designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses: '2+', favnDone: 'no', travelDateKnown: 'no', hasTransit: 'no' }
  );

  // 2. THE SECOND GAP FOUND DURING AUDIT: favnDone yes->no directly (rabiesDoses stays 2+).
  await mutateAndVerify(
    'favnDone yes->no',
    { designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses: '2+', favnDone: 'yes', travelDateKnown: 'no', hasTransit: 'no' },
    'favnDone',
    { designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses: '2+', favnDone: 'no', travelDateKnown: 'no', hasTransit: 'no' }
  );

  // 3. rabiesDoses dialed back down from 2+ to 1 (favnDone/favnDate must vanish).
  await mutateAndVerify(
    'rabiesDoses 2+->1',
    { designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses: '2+', favnDone: 'yes', travelDateKnown: 'no', hasTransit: 'no' },
    'rabiesDoses',
    { designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses: '1', favnDone: null, travelDateKnown: 'no', hasTransit: 'no' }
  );

  // 4. microchipDone yes->no (the original reported bug's root field).
  await mutateAndVerify(
    'microchipDone yes->no',
    { designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses: '2+', favnDone: 'yes', travelDateKnown: 'no', hasTransit: 'no' },
    'microchipDone',
    { designated: false, originCode: NON_DESIGNATED, microchipDone: 'no', rabiesDoses: null, favnDone: null, travelDateKnown: 'no', hasTransit: 'no' }
  );

  // 5. originCountry switched from non-designated (with full FAVN chain done) to designated.
  await mutateAndVerify(
    'originCountry CA->AU (designated switch)',
    { designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses: '2+', favnDone: 'yes', travelDateKnown: 'no', hasTransit: 'no' },
    'originCountry',
    { designated: true, originCode: DESIGNATED, microchipDone: 'yes', rabiesDoses: null, favnDone: null, travelDateKnown: 'no', hasTransit: 'no' }
  );

  // 6. Reverse direction: designated -> non-designated should correctly START ASKING the rabies/FAVN chain.
  await mutateAndVerify(
    'originCountry AU->CA (designated -> non-designated)',
    { designated: true, originCode: DESIGNATED, microchipDone: 'yes', rabiesDoses: null, favnDone: null, travelDateKnown: 'no', hasTransit: 'no' },
    'originCountry',
    { designated: false, originCode: NON_DESIGNATED, microchipDone: 'yes', rabiesDoses: '0', favnDone: null, travelDateKnown: 'no', hasTransit: 'no' }
  );

  await page.close();
}

async function run() {
  const { check, failures } = makeChecker();
  await withBrowser(async (browser) => {
    await runExhaustiveCombos(browser, check);
    await runMutationTests(browser, check);
  });
  console.log('\n=== wizard-exhaustive.test.js SUMMARY ===');
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
