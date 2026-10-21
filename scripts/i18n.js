#!/usr/bin/env node
// Translation tooling for port.dog. See js/i18n.js for the file format.
//
//   node scripts/i18n.js extract <out.json>          English source strings {key: text}
//   node scripts/i18n.js pack <lang> <translated.json>  write data/i18n/<lang>.json
//   node scripts/i18n.js check [lang...]              integrity + coverage report
//
// `check` exits non-zero on any integrity error (a translation that
// changed a number, dropped a placeholder/HTML tag/protected term, or
// is empty). Missing or stale keys are reported but are not errors —
// the site falls back to English for those, by design.
'use strict';
const fs = require('fs');
const path = require('path');
const I18N = require('../js/i18n.js');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'checklist-data.json');
const I18N_DIR = path.join(ROOT, 'data', 'i18n');

// Terms that must survive translation verbatim whenever the English has
// them: official form/test/system names people will see on real
// paperwork, and the brand. (Agency names are explained in-language but
// their acronyms are kept so readers can search for them.)
const PROTECTED = [
  'Form AC', 'Form AB', 'FAVN', 'RFFIT', 'NACCS', 'AQS', 'MAFF', 'CFIA', 'APHIS', 'VEHCS', 'CDC',
  'EHC 6407', 'ASE-3293', 'CEXGAN', 'BICON', 'IU/mL', 'ISO 11784/11785', 'port.dog', 'PayPal', 'Form AQS-279',
];

function loadEnglish() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const src = {};
  I18N.collect(data).forEach((e) => { src[e.key] = e.obj[e.prop]; });
  return src;
}

function placeholders(s) { return (s.match(/\{\w+\}/g) || []).sort(); }
function tags(s) { return (s.match(/<\/?[a-z][a-z0-9]*/gi) || []).map((x) => x.toLowerCase()).sort(); }
function numbers(s) {
  const norm = s.replace(/(\d)[,.  '’](?=\d)/g, '$1');
  return (norm.match(/\d+/g) || []).sort();
}
// Every number in the English must appear in the translation, and the
// translation may not add numbers — except that each English month NAME
// ("March 24, 2026") may become a month NUMBER where that's the natural
// date format (Chinese/Japanese "2026年3月24日").
const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/g;
function numbersMatch(en, tr) {
  const want = numbers(en);
  const got = numbers(tr);
  const remaining = got.slice();
  for (const n of want) {
    const i = remaining.indexOf(n);
    if (i === -1) return false;
    remaining.splice(i, 1);
  }
  const monthNames = (en.match(MONTHS) || []).length;
  return remaining.length <= monthNames && remaining.every((n) => +n >= 1 && +n <= 12);
}
function urls(s) { return (s.match(/https?:\/\/[^\s"'<)]+|[\w.+-]+@[\w-]+\.[\w.]+/g) || []).map((u) => u.replace(/[.,;:]+$/, '')).sort(); }
function sameMultiset(a, b) { return a.length === b.length && a.every((x, i) => x === b[i]); }

function integrityErrors(en, tr) {
  const errs = [];
  if (typeof tr !== 'string' || !tr.trim()) return ['empty translation'];
  if (!sameMultiset(placeholders(en), placeholders(tr))) errs.push('placeholders ' + JSON.stringify(placeholders(en)) + ' -> ' + JSON.stringify(placeholders(tr)));
  if (!sameMultiset(tags(en), tags(tr))) errs.push('HTML tags ' + JSON.stringify(tags(en)) + ' -> ' + JSON.stringify(tags(tr)));
  if (!numbersMatch(en, tr)) errs.push('numbers ' + JSON.stringify(numbers(en)) + ' -> ' + JSON.stringify(numbers(tr)));
  const eu = urls(en), tu = urls(tr);
  eu.forEach((u) => { if (tu.indexOf(u) === -1) errs.push('URL/email missing: ' + u); });
  PROTECTED.forEach((p) => {
    const need = en.split(p).length - 1;
    if (need && tr.split(p).length - 1 < need) errs.push('protected term missing: ' + p);
  });
  return errs;
}

function check(langs) {
  const src = loadEnglish();
  const keys = Object.keys(src);
  const report = {};
  let totalErrors = 0;
  langs.forEach((lang) => {
    const file = path.join(I18N_DIR, lang + '.json');
    const r = { lang, total: keys.length, ok: 0, missing: [], stale: [], extra: [], errors: [] };
    if (!fs.existsSync(file)) { r.missing = keys.slice(); report[lang] = r; return; }
    const strings = JSON.parse(fs.readFileSync(file, 'utf8')).strings || {};
    keys.forEach((k) => {
      const tr = strings[k];
      if (!tr) { r.missing.push(k); return; }
      if (tr[0] !== I18N.fnv1a(src[k])) { r.stale.push(k); return; }
      const errs = integrityErrors(src[k], tr[1]);
      if (errs.length) r.errors.push({ key: k, errors: errs });
      else r.ok++;
    });
    Object.keys(strings).forEach((k) => { if (!(k in src)) r.extra.push(k); });
    totalErrors += r.errors.length;
    report[lang] = r;
  });
  return { report, totalErrors };
}

function pack(lang, translatedPath) {
  if (!I18N.LANGS.some((l) => l.code === lang) || lang === 'en') throw new Error('unknown language: ' + lang);
  const src = loadEnglish();
  const translated = JSON.parse(fs.readFileSync(translatedPath, 'utf8'));
  const lines = [];
  let missing = 0;
  Object.keys(src).forEach((k) => {
    if (typeof translated[k] !== 'string' || !translated[k].trim()) { missing++; return; }
    lines.push('    ' + JSON.stringify(k) + ': ' + JSON.stringify([I18N.fnv1a(src[k]), translated[k]]));
  });
  fs.mkdirSync(I18N_DIR, { recursive: true });
  const out = '{\n  "lang": ' + JSON.stringify(lang) + ',\n  "strings": {\n' + lines.join(',\n') + '\n  }\n}\n';
  fs.writeFileSync(path.join(I18N_DIR, lang + '.json'), out);
  return { written: lines.length, missing };
}

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'extract') {
    const src = loadEnglish();
    fs.writeFileSync(args[0], JSON.stringify(src, null, 1));
    console.log('wrote', Object.keys(src).length, 'strings to', args[0]);
  } else if (cmd === 'pack') {
    console.log(pack(args[0], args[1]));
  } else if (cmd === 'check') {
    const langs = args.length ? args : I18N.LANGS.map((l) => l.code).filter((c) => c !== 'en');
    const { report, totalErrors } = check(langs);
    Object.values(report).forEach((r) => {
      console.log(r.lang + ': ' + r.ok + '/' + r.total + ' ok, ' + r.missing.length + ' missing, ' + r.stale.length + ' stale, ' + r.errors.length + ' integrity errors' + (r.extra.length ? ', ' + r.extra.length + ' obsolete keys' : ''));
      r.errors.slice(0, 30).forEach((e) => console.log('   ' + e.key + ': ' + e.errors.join('; ')));
    });
    process.exitCode = totalErrors ? 1 : 0;
  } else {
    console.log('usage: node scripts/i18n.js extract <out.json> | pack <lang> <translated.json> | check [lang...]');
    process.exitCode = 2;
  }
}

module.exports = { loadEnglish, integrityErrors, check, pack, PROTECTED };
