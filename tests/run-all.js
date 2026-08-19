// Runs every test suite in tests/*.test.js against a single local server.
// Usage: npm test (from the repo root; requires `npm install` first).
const { startServer } = require('./helpers');

const SUITES = ['./wizard-exhaustive.test.js', './date-feasibility.test.js', './regression.test.js', './country-content.test.js'];

async function main() {
  await startServer();
  let anyFailed = false;
  for (const suite of SUITES) {
    console.log('\n########## ' + suite + ' ##########');
    process.exitCode = undefined;
    await require(suite).run();
    if (process.exitCode) anyFailed = true;
  }
  process.exit(anyFailed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
