// Shared helpers for the PawPort Playwright test suite.
// Run via `npm test` (see tests/run-all.js) from the repo root.
const { chromium } = require('playwright');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8799;
const BASE = 'http://localhost:' + PORT;
const REPO_ROOT = path.join(__dirname, '..');

function fmtISO(d) { return d.toISOString().slice(0, 10); }
function daysFromNow(n) { return fmtISO(new Date(Date.now() + n * 86400000)); }

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', REPO_ROOT], { stdio: 'ignore' });
    proc.on('error', reject);
    // give it a moment to bind
    setTimeout(resolve, 600);
    proc.unref();
    process.on('exit', () => { try { proc.kill(); } catch (e) {} });
  });
}

async function withBrowser(fn) {
  const browser = await chromium.launch();
  try {
    await fn(browser);
  } finally {
    await browser.close();
  }
}

function makeChecker() {
  const failures = [];
  function check(name, cond, extra) {
    if (cond) { console.log('PASS:', name); }
    else { console.log('FAIL:', name, extra !== undefined ? extra : ''); failures.push(name); }
  }
  return { check, failures };
}

async function setAnswers(page, answers) {
  await page.goto(BASE + '/#/home');
  await page.evaluate((a) => localStorage.setItem('pawport_answers_v1', JSON.stringify(a)), answers);
}

async function goToResults(page) {
  await page.goto(BASE + '/#/results');
  // '.results-header' only, not '.card' — '.card' is generic enough to
  // match a still-present prior page's card during the async
  // hashchange-triggered re-render, causing false "not found" reads
  // immediately after.
  await page.waitForSelector('.results-header');
}

module.exports = { BASE, PORT, fmtISO, daysFromNow, startServer, withBrowser, makeChecker, setAnswers, goToResults };
