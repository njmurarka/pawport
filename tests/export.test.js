// Covers the "Download as image" / "Download as one-page PDF" buttons on
// the results page. Validation here is deliberately tool-independent (no
// qpdf/pdftoppm/ImageMagick shelled out) so this suite runs anywhere
// npm test does — the PDF bytes were rigorously checked against qpdf
// --check, pdfinfo, and pdftoppm rendering during development instead;
// see PROJECT-MEMORY.md. These tests re-check the same structural
// properties in plain JS: valid PDF header/trailer, exactly one page,
// and a PNG with sane, non-trivial dimensions.

const fs = require('fs');
const { BASE, withBrowser, makeChecker, setAnswers } = require('./helpers');

function readPngDimensions(buf) {
  // PNG: 8-byte signature, then an IHDR chunk whose data starts at byte
  // 16 with 4-byte width, 4-byte height (big-endian). No need for a full
  // PNG parser for this.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function downloadViaButton(page, buttonId) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(buttonId).click(),
  ]);
  const path = await download.path();
  return { path, filename: download.suggestedFilename(), bytes: fs.readFileSync(path) };
}

async function run() {
  const { check, failures } = makeChecker();

  await withBrowser(async (browser) => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1000, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => check('No uncaught page error during export', false, err.message));

    await setAnswers(page, {
      originCountry: 'CA', dogName: 'Miso', healthConditions: ['none'], microchipDone: 'yes', rabiesDoses: '2+',
      favnDone: 'yes', favnDate: fmtISO(new Date(Date.now() - 200 * 86400000)),
      travelDateKnown: 'no', hasTransit: 'no',
    });
    await page.goto(BASE + '/#/results');
    await page.waitForSelector('.results-header');

    check('html2canvas (vendored) loaded successfully', await page.evaluate(() => typeof window.html2canvas) === 'function');
    check('Both export buttons are present', await page.locator('#btnDownloadPng').count() === 1 && await page.locator('#btnDownloadPdf').count() === 1);

    // ---------- PNG ----------
    {
      const { filename, bytes } = await downloadViaButton(page, '#btnDownloadPng');
      check('PNG filename includes the dog name', filename === 'pawport-checklist-miso.png', 'got: ' + filename);
      check('PNG has a valid PNG signature', bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
      const dims = readPngDimensions(bytes);
      check('PNG width matches the content column width (~900px)', dims.width >= 850 && dims.width <= 950, 'width=' + dims.width);
      check('PNG height reflects the FULL long checklist, not a single viewport', dims.height > 2000, 'height=' + dims.height);
      const btnText = await page.locator('#btnDownloadPng').textContent();
      check('PNG button restores its label after finishing (not stuck on "Preparing…")', /download as image/i.test(btnText), 'text=' + btnText);
      const btnDisabled = await page.locator('#btnDownloadPng').isDisabled();
      check('PNG button re-enables after finishing', btnDisabled === false);
    }

    // ---------- PDF ----------
    {
      const { filename, bytes } = await downloadViaButton(page, '#btnDownloadPdf');
      check('PDF filename includes the dog name', filename === 'pawport-checklist-miso.pdf', 'got: ' + filename);
      const text = bytes.toString('latin1');
      check('PDF has a valid header', text.startsWith('%PDF-1.4'));
      check('PDF ends with %%EOF', text.trim().endsWith('%%EOF'));
      check('PDF declares exactly one page (/Count 1)', /\/Count 1\b/.test(text));
      const mediaBoxMatch = text.match(/\/MediaBox \[0 0 (\d+) (\d+)\]/);
      check('PDF has a single MediaBox sized to the full long content, not a standard paginated size', !!mediaBoxMatch && Number(mediaBoxMatch[2]) > 1500, 'MediaBox=' + (mediaBoxMatch && mediaBoxMatch[0]));
      check('PDF embeds a DCTDecode (JPEG) image, not re-encoded pixel data', /\/Filter \/DCTDecode/.test(text));
      const btnText = await page.locator('#btnDownloadPdf').textContent();
      check('PDF button restores its label after finishing', /download as one-page pdf/i.test(btnText), 'text=' + btnText);
    }

    // ---------- Failure path: library unavailable -> friendly alert, button recovers ----------
    {
      await page.evaluate(() => { window.__realHtml2Canvas = window.html2canvas; window.html2canvas = undefined; });
      let alertMessage = null;
      page.once('dialog', async (dialog) => { alertMessage = dialog.message(); await dialog.accept(); });
      await page.locator('#btnDownloadPng').click();
      await page.waitForTimeout(300);
      check('Missing export library shows a friendly alert, not a silent failure or crash', !!alertMessage && /didn.t work/i.test(alertMessage), 'alert=' + alertMessage);
      const stillDisabled = await page.locator('#btnDownloadPng').isDisabled();
      check('Button re-enables even after a failed export', stillDisabled === false);
      await page.evaluate(() => { window.html2canvas = window.__realHtml2Canvas; });
    }

    await page.close();
  });

  console.log('\n=== export.test.js SUMMARY ===');
  if (failures.length) {
    console.log('FAILURES:', failures.length);
    failures.forEach((f) => console.log(' -', f));
    process.exitCode = 1;
  } else {
    console.log('All checks passed.');
  }
}

function fmtISO(d) { return d.toISOString().slice(0, 10); }

module.exports = { run };
if (require.main === module) run();
