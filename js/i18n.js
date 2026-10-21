/* port.dog translations — shared by the browser (window.PortDogI18n) and
   the Node tooling/tests (require('./js/i18n.js')), so both always agree
   on exactly which strings are translatable and how they're keyed.

   English in data/checklist-data.json is the single source of truth.
   Each language file (data/i18n/<code>.json) stores, per key, the FNV-1a
   hash of the English text it was translated FROM plus the translation:
     { "lang": "de", "strings": { "<key>": ["<hash>", "<text>"] } }
   applyOverlay() only uses a translation whose hash still matches the
   current English. Edit an English string and every translation of it
   silently falls back to English until it's re-translated — so a stale
   translation can never show an outdated rule. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PortDogI18n = factory();
})(this, function () {
  'use strict';

  // Order = order shown in the language menu. `flag` is a file in
  // assets/flags/ (flag-icons, MIT). `locale` drives date formatting.
  var LANGS = [
    { code: 'en', name: 'English', english: 'English', flag: 'gb', locale: 'en' },
    { code: 'zh', name: '中文', english: 'Chinese (Mandarin)', flag: 'cn', locale: 'zh-CN' },
    { code: 'hi', name: 'हिन्दी', english: 'Hindi', flag: 'in', locale: 'hi-IN' },
    { code: 'es', name: 'Español', english: 'Spanish', flag: 'es', locale: 'es' },
    { code: 'fr', name: 'Français', english: 'French', flag: 'fr', locale: 'fr' },
    { code: 'de', name: 'Deutsch', english: 'German', flag: 'de', locale: 'de' },
    { code: 'ja', name: '日本語', english: 'Japanese', flag: 'jp', locale: 'ja' },
    { code: 'ru', name: 'Русский', english: 'Russian', flag: 'ru', locale: 'ru' },
    { code: 'nl', name: 'Nederlands', english: 'Dutch', flag: 'nl', locale: 'nl' }
  ];

  // 32-bit FNV-1a over UTF-16 code units, as 8 hex chars. Not crypto —
  // just a cheap, stable fingerprint of the English source text.
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // Every translatable string in the data, as { key, obj, prop }.
  // Keys are built from stable ids wherever the data has them; the few
  // id-less lists (glossary, FAQ items, sources) use their index, which
  // is safe because the hash check rejects a translation if the English
  // at that index changes (e.g. after a reorder).
  function collect(data) {
    var out = [];
    function add(key, obj, prop) {
      if (obj && typeof obj[prop] === 'string' && obj[prop] !== '') out.push({ key: key, obj: obj, prop: prop });
    }
    add('tagline', data, 'tagline');
    Object.keys(data.ui || {}).forEach(function (k) { add('ui.' + k, data.ui, k); });
    (data.wizard || []).forEach(function (q) {
      ['label', 'help', 'why', 'placeholder'].forEach(function (p) { add('wizard.' + q.id + '.' + p, q, p); });
      (q.options || []).forEach(function (o) { add('wizard.' + q.id + '.opt.' + o.value, o, 'label'); });
    });
    (data.countries || []).forEach(function (c) { add('country.' + c.code, c, 'name'); });
    (data.categories || []).forEach(function (c) {
      add('category.' + c.id + '.title', c, 'title');
      add('category.' + c.id + '.blurb', c, 'blurb');
    });
    (data.checklistItems || []).forEach(function (it) {
      add('item.' + it.id + '.title', it, 'title');
      add('item.' + it.id + '.body', it, 'body');
    });
    Object.keys(data.countryDetails || {}).forEach(function (code) {
      Object.keys(data.countryDetails[code]).forEach(function (f) { add('detail.' + code + '.' + f, data.countryDetails[code], f); });
    });
    if (data.caseStudy) {
      add('caseStudy.title', data.caseStudy, 'title');
      add('caseStudy.summary', data.caseStudy, 'summary');
    }
    (data.glossary || []).forEach(function (g, i) {
      add('glossary.' + i + '.term', g, 'term');
      add('glossary.' + i + '.definition', g, 'definition');
    });
    (data.faqGroups || []).forEach(function (g) {
      add('faq.' + g.id + '.title', g, 'title');
      add('faq.' + g.id + '.intro', g, 'intro');
      (g.items || []).forEach(function (it, i) {
        add('faq.' + g.id + '.' + i + '.q', it, 'q');
        add('faq.' + g.id + '.' + i + '.a', it, 'a');
      });
    });
    (data.officialSources || []).forEach(function (s, i) { add('source.' + i + '.label', s, 'label'); });
    return out;
  }

  // Swap in every translation whose source hash still matches the
  // English currently in `data`. Mutates `data`; returns counts.
  function applyOverlay(data, overlay) {
    var strings = (overlay && overlay.strings) || {};
    var stats = { applied: 0, stale: 0, missing: 0 };
    collect(data).forEach(function (e) {
      var tr = strings[e.key];
      if (!tr || typeof tr[1] !== 'string' || tr[1] === '') { stats.missing++; return; }
      if (tr[0] !== fnv1a(e.obj[e.prop])) { stats.stale++; return; }
      e.obj[e.prop] = tr[1];
      stats.applied++;
    });
    return stats;
  }

  return { LANGS: LANGS, fnv1a: fnv1a, collect: collect, applyOverlay: applyOverlay };
});
