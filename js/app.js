(function () {
  'use strict';

  var STORAGE_KEYS = { answers: 'pawport_answers_v1', checked: 'pawport_checked_v1' };
  var DATA = null;
  var countriesByCode = {};
  var DATA_SCHEMA_VERSION = 1;

  // The maintainer's own links. The QR code in assets/img/paypal-qr.svg
  // encodes DONATE_URL — regenerate it if this ever changes.
  var DONATE_URL = 'https://paypal.me/loquitus';
  var DONATE_LABEL = 'paypal.me/loquitus';
  var LINKEDIN_URL = 'https://www.linkedin.com/in/njmurarka/';

  /* ================= anonymous analytics (GoatCounter) =================
     Cookie-free and no personal data: only page names (/home, /wizard…)
     and a few named milestones are ever sent — never answers, dog names,
     dates or anything typed. js/vendor/goatcounter-count.js loads async
     and ignores localhost, so tests and local dev send nothing. Calls
     made before it finishes loading are queued, then flushed. */
  var trackQueue = [];
  function track(path, title, isEvent) {
    trackQueue.push({ path: path, title: title || path, event: !!isEvent });
    flushTracking();
  }
  function flushTracking() {
    var gc = window.goatcounter;
    if (!gc || typeof gc.count !== 'function') return;
    while (trackQueue.length) {
      try { gc.count(trackQueue.shift()); } catch (e) { /* analytics must never break the site */ }
    }
  }
  function trackLanguageOnce() {
    if (LANG === 'en') return;
    try {
      if (sessionStorage.getItem('portdog_lang_tracked') === LANG) return;
      sessionStorage.setItem('portdog_lang_tracked', LANG);
    } catch (e) { /* private mode etc. — just count it */ }
    track('language/' + LANG, 'Viewed in ' + langInfo(LANG).english, true);
  }

  /* ================= language =================
     English (data/checklist-data.json) is the source of truth; other
     languages are overlays in data/i18n/<code>.json applied at load —
     see js/i18n.js for the format and the stale-translation guard.
     The choice lives in a cookie (like the theme) and switching
     reloads the page, so every renderer just reads the merged DATA. */
  var I18N = window.PortDogI18n;
  var I18N_VERSION = 3; // bump whenever any data/i18n/*.json changes (cache-busting)
  var LANG_COOKIE = 'portdog_lang';
  function langInfo(code) {
    for (var i = 0; i < I18N.LANGS.length; i++) if (I18N.LANGS[i].code === code) return I18N.LANGS[i];
    return I18N.LANGS[0];
  }
  var LANG = (function () {
    var m = document.cookie.match(/(?:^|; )portdog_lang=([^;]*)/);
    return langInfo(m && decodeURIComponent(m[1])).code;
  })();
  var LOCALE = langInfo(LANG).locale;
  function setLang(code) {
    var expires = new Date(Date.now() + 365 * 86400000).toUTCString();
    document.cookie = LANG_COOKIE + '=' + encodeURIComponent(code) + '; expires=' + expires + '; path=/; SameSite=Lax';
    location.reload();
  }
  // UI strings may contain trusted markup (from our own data file); any
  // user-supplied value passed in `vars` must already be escaped.
  function t(key, vars) {
    var s = DATA && DATA.ui && typeof DATA.ui[key] === 'string' ? DATA.ui[key] : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m; });
    return s;
  }

  /* ================= forward/backward-compatible answers =================
     Answers live in localStorage indefinitely (an app UPDATE must never
     lose them) and can also arrive via a JSON import from any previous
     export, a different device, or a hand-edited file. A future update to
     this app can add, remove, reorder, or rename wizard questions and
     their option values — none of that may ever crash or show garbage.

     Reordering DATA.wizard is inherently safe already: answers are keyed
     by question id, never by position. The two real risks are (1) a
     field/option that no longer exists under the CURRENTLY loaded data,
     and (2) a malformed value (wrong type, hand-edited JSON, a future
     breaking schema change). sanitizeAnswers rebuilds the answers object
     from scratch, copying a value over only if it's still valid under
     whatever DATA.wizard defines right now; anything that fails that
     check is silently dropped rather than kept as stale/garbage data —
     the wizard just asks that question again, which is the correct, safe
     fallback. sanitizeChecked does the same for checklist-item ids. */
  function sanitizeAnswers(raw) {
    if (!raw || typeof raw !== 'object') return {};
    var clean = {};
    DATA.wizard.forEach(function (q) {
      if (!Object.prototype.hasOwnProperty.call(raw, q.id)) return;
      var val = raw[q.id];
      if (q.type === 'checkboxGroup') {
        if (!Array.isArray(val)) return;
        var allowedValues = (q.options || []).map(function (o) { return o.value; });
        var filtered = val.filter(function (v) { return allowedValues.indexOf(v) !== -1; });
        if (filtered.length) clean[q.id] = filtered;
      } else if (q.type === 'radio') {
        var allowedRadio = (q.options || []).map(function (o) { return o.value; });
        if (typeof val === 'string' && allowedRadio.indexOf(val) !== -1) clean[q.id] = val;
      } else if (q.type === 'select') {
        var validCodes = q.optionsFrom === 'countries' ? DATA.countries.map(function (c) { return c.code; }) : [];
        if (typeof val === 'string' && validCodes.indexOf(val) !== -1) clean[q.id] = val;
      } else if (q.type === 'date') {
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val) && !isNaN(Date.parse(val))) clean[q.id] = val;
      } else if (q.type === 'text') {
        if (typeof val === 'string') clean[q.id] = val;
      }
    });
    return clean;
  }
  function sanitizeChecked(raw) {
    if (!raw || typeof raw !== 'object') return {};
    var validIds = {};
    DATA.checklistItems.forEach(function (item) { validIds[item.id] = true; });
    var clean = {};
    Object.keys(raw).forEach(function (id) { if (validIds[id] && raw[id]) clean[id] = true; });
    return clean;
  }
  /* Seam for future schema migrations. A no-op today — schema v1 is the
     only version that has ever existed — but any future BREAKING change
     (renaming a field, changing what an option value means) gets a real
     migration step added here, keyed off payload.version, run before
     sanitizeAnswers so the rest of the app never has to know the history. */
  function migrateAnswers(payload) {
    return (payload && payload.answers) || {};
  }

  /* ================= storage ================= */
  function loadAnswers() {
    try { return sanitizeAnswers(JSON.parse(localStorage.getItem(STORAGE_KEYS.answers)) || {}); }
    catch (e) { return {}; }
  }
  function saveAnswers(a) {
    try { localStorage.setItem(STORAGE_KEYS.answers, JSON.stringify(a)); } catch (e) {}
  }
  function loadChecked() {
    try { return sanitizeChecked(JSON.parse(localStorage.getItem(STORAGE_KEYS.checked)) || {}); }
    catch (e) { return {}; }
  }
  function saveChecked(c) {
    try { localStorage.setItem(STORAGE_KEYS.checked, JSON.stringify(c)); } catch (e) {}
  }

  /* ================= theme (light/dark) =================
     A cookie (not localStorage) per explicit request, so the choice
     persists the same way across any future server-side use too.
     The actual theme is applied before first paint by the inline
     script in index.html's <head> — this just keeps the toggle button
     and the cookie in sync with whatever's already on <html>. */
  var THEME_COOKIE = 'pawport_theme';
  function setThemeCookie(value) {
    var expires = new Date(Date.now() + 365 * 86400000).toUTCString();
    document.cookie = THEME_COOKIE + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var isDark = theme === 'dark';
    var label = isDark ? t('theme.toLight') : t('theme.toDark');
    ['themeToggle', 'themeToggleMenu'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.querySelector('.theme-toggle-icon').textContent = isDark ? '☀️' : '🌙';
      btn.querySelector('.theme-toggle-label').textContent = isDark ? t('theme.light') : t('theme.dark');
      btn.setAttribute('aria-label', label);
      btn.title = label;
    });
    fitHeader(); // the label's length differs per language and per state
  }
  function wireThemeToggle() {
    var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(current);
    ['themeToggle', 'themeToggleMenu'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        current = current === 'dark' ? 'light' : 'dark';
        applyTheme(current);
        setThemeCookie(current);
      });
    });
  }

  /* ================= date helpers ================= */
  function parseDate(s) {
    if (!s) return null;
    var d = new Date(s + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function addYears(d, n) { var r = new Date(d); r.setFullYear(r.getFullYear() + n); return r; }
  function fmtDate(d) {
    if (!d) return '';
    var out = d.toLocaleDateString(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' });
    // Russian dates end in "г." — drop it so a sentence ending in a date
    // doesn't get a double period ("2026 г..").
    return LOCALE === 'ru' ? out.replace(/\s?г\.$/, '') : out;
  }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function todayDateOnly() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }

  /* ================= effective answers =================
     Going back and changing any earlier answer must be reflected
     everywhere downstream — the wizard's own showIf already makes it
     re-ask the right questions going forward, but anything the user
     answered BEFORE the change stays in storage untouched, and the
     results/checklist page reads that storage directly. So for every
     wizard field whose showIf depends on another field, we mirror
     that exact same condition here and null the answer out if it no
     longer holds — using the ALREADY-normalized eff values (not the
     raw stored ones) so the nulling cascades correctly however many
     links deep the chain goes:
       rabiesDoses      <- originCountry (designated) + microchipDone
       lastRabiesDate   <- rabiesDoses
       rabiesDuration   <- rabiesDoses
       favnDone         <- originCountry (designated) + microchipDone + rabiesDoses
       favnDate         <- favnDone
       travelDate       <- travelDateKnown
       aqsNotified      <- travelDateKnown
       aqsNotifiedDate  <- travelDateKnown + aqsNotified
     Add a line here for any new conditional wizard question. */
  function getEffectiveAnswers(answers) {
    var eff = {};
    for (var k in answers) { if (Object.prototype.hasOwnProperty.call(answers, k)) eff[k] = answers[k]; }
    var country = countriesByCode[eff.originCountry];
    var designated = !!(country && country.designated);

    if (designated || eff.microchipDone !== 'yes') {
      eff.rabiesDoses = designated ? undefined : '0';
    }
    if (eff.rabiesDoses !== '1' && eff.rabiesDoses !== '2+') {
      eff.lastRabiesDate = undefined;
      eff.rabiesDuration = undefined;
    }
    // FAVN can only follow the FINAL rabies dose in the required 2-dose
    // series, so it can't have happened unless rabiesDoses is '2+'.
    if (designated || eff.rabiesDoses !== '2+') {
      eff.favnDone = designated ? undefined : 'no';
    }
    if (eff.favnDone !== 'yes') {
      eff.favnDate = undefined;
    }
    if (eff.travelDateKnown !== 'yes') {
      eff.travelDate = undefined;
      eff.aqsNotified = undefined;
      eff.aqsNotifiedDate = undefined;
    }
    if (eff.aqsNotified !== 'yes') {
      eff.aqsNotifiedDate = undefined;
    }
    return eff;
  }

  function computeAllDates(answers) {
    var out = {};
    var favnDate = parseDate(answers.favnDate);
    var travelDate = parseDate(answers.travelDate);
    var lastRabiesDate = parseDate(answers.lastRabiesDate);

    if (favnDate) {
      out.favn180 = { label: t('dates.favn180'), value: addDays(favnDate, 180) };
      var validityEnd = addYears(favnDate, 2);
      out.favnValidityEnd = { label: t('dates.favnValidityEnd'), value: validityEnd };
      // MAFF: a second antibody test needs no new 180-day wait if vaccine
      // coverage never lapsed and its draw is >= 180 days after the first.
      out.favnRetestEarliest = {
        label: t('dates.retest'),
        value: addDays(favnDate, 180),
        note: t('dates.retestNote', { date: fmtDate(validityEnd) })
      };
    }
    if (lastRabiesDate && answers.rabiesDuration && answers.rabiesDuration !== 'unsure') {
      var years = answers.rabiesDuration === '1yr' ? 1 : 3;
      var bufferDays = answers.rabiesDuration === '1yr' ? 21 : 40;
      var dueDate = addYears(lastRabiesDate, years);
      var bufferDate = addDays(dueDate, -bufferDays);
      out.boosterBufferDate = {
        label: t('dates.booster'),
        value: bufferDate,
        note: t('dates.boosterNote', { date: fmtDate(dueDate), days: bufferDays })
      };
    }
    if (travelDate) {
      out.advanceNotificationDeadline = { label: t('dates.aqsBy'), value: addDays(travelDate, -40) };
      out.preExportExamWindow = {
        label: t('dates.examOpens'),
        value: addDays(travelDate, -10),
        note: t('dates.examNote', { date: fmtDate(addDays(travelDate, -10)) })
      };
    }
    return out;
  }

  /* ================= feasibility checks =================
     The checklist below is honest about what's required, but a wizard
     that just lists items can still let someone walk away thinking
     "OK, I have a plan" when their stated travel date is flatly
     impossible under Japan's rules (e.g. no FAVN done yet, flying in a
     week). This surfaces those as unmissable alerts, not just another
     checklist row. Uses effective answers (eff), so a stale/never-asked
     rabiesDoses or favnDone can't hide a real problem. */
  function computeEarliestFavnDrawDate(eff, today) {
    var lastRabies = parseDate(eff.lastRabiesDate);
    var rd = eff.rabiesDoses;
    if (rd === '2+') return today; // best case: draw can happen right away
    if (rd === '1') {
      var secondEarliest = addDays(lastRabies || today, 30);
      return secondEarliest > today ? secondEarliest : today;
    }
    // '0', 'unsure', or not started (no microchip yet): best case is
    // first dose today, second dose in 30 days, draw the same day.
    return addDays(today, 30);
  }

  function computeFeasibilityAlerts(eff, dates, country, today) {
    var alerts = [];
    var travelDate = parseDate(eff.travelDate);
    var nonDesignated = !!(country && !country.designated);

    if (nonDesignated) {
      var earliestTravel = null, basisNote = '';
      if (eff.favnDone === 'yes') {
        if (dates.favn180) { earliestTravel = dates.favn180.value; basisNote = t('alert.basisFavn'); }
      } else {
        var earliestDraw = computeEarliestFavnDrawDate(eff, today);
        earliestTravel = addDays(earliestDraw, 180);
        basisNote = t('alert.basisBest');
      }

      if (earliestTravel && travelDate && travelDate < earliestTravel) {
        alerts.push({
          level: 'blocker',
          title: t('alert.impossible.title'),
          detail: t('alert.impossible.detail', { earliest: fmtDate(earliestTravel), basis: basisNote, days: daysBetween(travelDate, earliestTravel), travel: fmtDate(travelDate) })
        });
      }

      if (eff.favnDone === 'yes' && dates.favnValidityEnd && travelDate && travelDate > dates.favnValidityEnd.value) {
        alerts.push({
          level: 'urgent',
          title: t('alert.retest.title'),
          detail: t('alert.retest.detail', { end: fmtDate(dates.favnValidityEnd.value), travel: fmtDate(travelDate), drawFrom: fmtDate(addDays(parseDate(eff.favnDate), 180)) })
        });
      }

      var lastRabies = parseDate(eff.lastRabiesDate);
      var years = eff.rabiesDuration === '1yr' ? 1 : (eff.rabiesDuration === '3yr' ? 3 : null);
      if (lastRabies && years) {
        var dueDate = addYears(lastRabies, years);
        if (dueDate < today) {
          alerts.push({
            level: 'blocker',
            title: t('alert.lapsed.title'),
            detail: t('alert.lapsed.detail', { due: fmtDate(dueDate) })
          });
        } else if (travelDate && dueDate < travelDate) {
          alerts.push({
            level: 'blocker',
            title: t('alert.willLapse.title'),
            detail: t('alert.willLapse.detail', { due: fmtDate(dueDate), travel: fmtDate(travelDate) })
          });
        }
      }
    }

    if (dates.advanceNotificationDeadline) {
      var deadline = dates.advanceNotificationDeadline.value;
      var notifiedDate = parseDate(eff.aqsNotifiedDate);
      var deadlinePassed = today > deadline;

      if (eff.aqsNotified === 'yes' && notifiedDate) {
        if (notifiedDate > deadline) {
          alerts.push({
            level: 'urgent',
            title: t('alert.aqsLate.title'),
            detail: t('alert.aqsLate.detail', { filed: fmtDate(notifiedDate), deadline: fmtDate(deadline) })
          });
        }
        // else: filed on or before the deadline — fully compliant, no alert.
      } else if (eff.aqsNotified === 'yes') {
        // Filed, but no date given to check it against the deadline.
        if (deadlinePassed) {
          alerts.push({
            level: 'urgent',
            title: t('alert.aqsNoDate.title'),
            detail: t('alert.aqsNoDate.detail', { deadline: fmtDate(deadline) })
          });
        }
      } else if (deadlinePassed) {
        // Not yet notified (or unsure/unanswered) and the deadline has passed.
        alerts.push({
          level: 'urgent',
          title: t('alert.aqsPast.title'),
          detail: t('alert.aqsPast.detail', { deadline: fmtDate(deadline) })
        });
      }
    }

    return alerts;
  }

  /* ================= condition matching ================= */
  function matchOne(cond, answers) {
    if (!cond) return true;
    var val = answers[cond.field];
    if (cond.equals !== undefined) return val === cond.equals;
    if (cond.in) return cond.in.indexOf(val) !== -1;
    if (cond.exists) return val !== undefined && val !== null && val !== '';
    if (cond.isDesignated !== undefined) {
      var c = countriesByCode[val];
      if (!c) return false;
      return !!c.designated === cond.isDesignated;
    }
    if (cond.excludesOnly !== undefined) {
      var arr = Array.isArray(val) ? val : [];
      return arr.some(function (v) { return v !== cond.excludesOnly; });
    }
    return true;
  }
  function matches(showIf, answers) {
    if (!showIf) return true;
    if (Array.isArray(showIf)) return showIf.every(function (c) { return matchOne(c, answers); });
    return matchOne(showIf, answers);
  }

  /* ================= utils ================= */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /* ================= router ================= */
  function currentRoute() {
    var hash = location.hash || '#/home';
    return hash.replace('#/', '').split('?')[0] || 'home';
  }

  function closeMobileNav() {
    var nav = document.getElementById('siteNav');
    if (nav) nav.classList.remove('open');
  }

  function navigate() {
    // A popup belongs to the page it was opened on — close it if the
    // route changes underneath it (back button, a link inside it, etc.).
    if (activeModalClose) activeModalClose();
    var route = currentRoute();
    document.querySelectorAll('.site-nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#/' + route);
    });
    var app = document.getElementById('app');
    app.innerHTML = '';
    app.classList.remove('route-enter');
    // eslint-disable-next-line no-unused-expressions
    void app.offsetWidth; // restart the fade-in animation on every navigation
    app.classList.add('route-enter');
    track('/' + route, route);
    if (route === 'wizard') renderWizard(app);
    else if (route === 'results') renderResults(app);
    else if (route === 'resources') renderResources(app);
    else if (route === 'about') renderAbout(app);
    else renderHome(app);
    window.scrollTo(0, 0);
    closeMobileNav();
  }

  /* ================= HOME ================= */
  function renderHome(app) {
    app.appendChild(el(
      '<section class="hero">' +
        '<figure class="hero-media">' +
          '<picture>' +
            '<source media="(max-width: 640px)" type="image/webp" srcset="assets/img/hero-main-mobile-720.webp 720w, assets/img/hero-main-mobile-1080.webp 1080w" sizes="100vw">' +
            '<source type="image/webp" srcset="assets/img/hero-main-1290.webp 1290w, assets/img/hero-main-2150.webp 2150w" sizes="(max-width: 1160px) 100vw, 1120px">' +
            '<img src="assets/img/hero-main-1290.jpg" width="1290" height="621" fetchpriority="high" alt="' + escapeHtml(t('home.heroAlt')) + '">' +
          '</picture>' +
        '</figure>' +
        '<span class="tag">' + t('home.tag') + '</span>' +
        '<h1>' + t('home.title') + '</h1>' +
        '<p class="lede">' + t('home.lede') + '</p>' +
        '<div class="cta-row">' +
          '<a href="#/wizard" class="btn-primary" data-nav>' + t('home.ctaStart') + '</a>' +
          '<a href="#/resources" class="btn-secondary" data-nav>' + t('home.ctaFaq') + '</a>' +
        '</div>' +
        '<p class="muted"><button type="button" class="skip-link" id="btnImportHome">' + t('home.import') + '</button></p>' +
      '</section>'
    ));
    document.getElementById('btnImportHome').addEventListener('click', openImportModal);

    app.appendChild(el(
      '<section class="feature-grid">' +
        '<div class="feature-card"><img class="feature-thumb" src="assets/img/feature-route.webp" width="64" height="64" alt="" loading="lazy"><h3>' + t('home.f1.title') + '</h3><p>' + t('home.f1.body') + '</p></div>' +
        '<div class="feature-card"><img class="feature-thumb" src="assets/img/feature-plane.webp" width="64" height="64" alt="" loading="lazy"><h3>' + t('home.f2.title') + '</h3><p>' + t('home.f2.body') + '</p></div>' +
        '<div class="feature-card"><img class="feature-thumb" src="assets/img/feature-passport.webp" width="64" height="64" alt="" loading="lazy"><h3>' + t('home.f3.title') + '</h3><p>' + t('home.f3.body') + '</p></div>' +
      '</section>'
    ));

    app.appendChild(el(
      '<section class="story-callout story-callout-portrait">' +
        '<img class="story-portrait" src="assets/img/avatar-192.webp" width="96" height="96" alt="" loading="lazy">' +
        '<div>' +
        '<h2>' + t('home.why.title') + '</h2>' +
        '<p>' + t('home.why.body') + '</p>' +
        '<p><a href="#/about" data-nav>' + t('home.why.link') + '</a></p>' +
        '</div>' +
      '</section>'
    ));

    app.appendChild(el(
      '<section class="card">' +
        '<h2>' + t('home.before.title') + '</h2>' +
        '<p>' + t('home.before.body') + '</p>' +
      '</section>'
    ));

  }

  /* ================= about the maker / donate ================= */
  function donateInnerHtml(headingTag) {
    return (
      '<div class="donate-text">' +
        '<' + headingTag + ' class="donate-heading">' + t('donate.heading') + '</' + headingTag + '>' +
        '<p>' + t('donate.p1') + '</p>' +
        '<p>' + t('donate.p2') + '</p>' +
        '<p class="donate-actions"><a class="btn-primary" href="' + DONATE_URL + '" target="_blank" rel="noopener">' + t('donate.button') + '</a></p>' +
        '<p class="muted donate-link">' + t('donate.orGoTo', { link: '<a href="' + DONATE_URL + '" target="_blank" rel="noopener">' + DONATE_LABEL + '</a>' }) + '</p>' +
      '</div>' +
      '<figure class="donate-qr">' +
        '<img src="assets/img/paypal-qr.svg" width="180" height="180" alt="' + escapeHtml(t('donate.qrAlt', { label: DONATE_LABEL })) + '" loading="lazy">' +
        '<figcaption>' + t('donate.qrCaption') + '</figcaption>' +
      '</figure>'
    );
  }

  function openDonateModal() {
    track('donate-panel-opened', 'Opened the donate panel', true);
    openModal(t('donate.title'), el('<div class="donate-layout">' + donateInnerHtml('h4') + '</div>'));
  }

  function openAboutModal() {
    var m = openModal(t('maker.title'), el(
      '<div>' +
        '<div class="about-maker">' +
          '<img class="about-avatar" src="assets/img/maker-176.webp" srcset="assets/img/maker-176.webp 1x, assets/img/maker-352.webp 2x" width="88" height="88" alt="Neeraj Murarka">' +
          '<div>' +
            '<p class="about-name">Neeraj Murarka</p>' +
            '<p class="about-role">' + t('maker.role') + '</p>' +
          '</div>' +
        '</div>' +
        '<p>' + t('maker.bio') + '</p>' +
        '<p class="about-dogs">' + t('maker.dogs') + '</p>' +
        '<div class="modal-actions">' +
          '<a class="btn-secondary" href="' + LINKEDIN_URL + '" target="_blank" rel="noopener">' + t('maker.linkedin') + '</a>' +
          '<button type="button" class="btn-primary" id="aboutDonateBtn">' + t('donate.title') + '</button>' +
        '</div>' +
      '</div>'
    ));
    m.modal.querySelector('#aboutDonateBtn').addEventListener('click', function () {
      m.close();
      openDonateModal();
    });
  }

  /* ================= ABOUT ================= */
  function renderAbout(app) {
    app.appendChild(el(
      '<section class="card">' +
        '<figure class="story-banner">' +
          '<img src="assets/img/story-hero-900.webp" srcset="assets/img/story-hero-900.webp 900w, assets/img/story-hero-1600.webp 1600w" sizes="(max-width: 940px) 100vw, 900px" width="900" height="347" alt="' + escapeHtml(t('story.bannerAlt')) + '">' +
        '</figure>' +
        '<h1>' + t('story.title') + '</h1>' +
        '<p class="muted">' + t('story.note') + '</p>' +
        '<h2>' + t('story.started.h') + '</h2>' +
        '<p>' + t('story.started.p1') + '</p>' +
        '<p>' + t('story.started.p2') + '</p>' +
        '<h2>' + t('story.advice.h') + '</h2>' +
        '<p>' + t('story.advice.p1') + '</p>' +
        '<p>' + t('story.advice.p2') + '</p>' +
        '<h2>' + t('story.country.h') + '</h2>' +
        '<p>' + t('story.country.p1') + '</p>' +
        '<p>' + t('story.country.p2') + '</p>' +
        '<p>' + t('story.country.p3') + '</p>' +
        '<h2>' + t('story.deadlines.h') + '</h2>' +
        '<p>' + t('story.deadlines.p1') + '</p>' +
        '<p>' + t('story.deadlines.p2') + '</p>' +
        '<h2>' + t('story.paperwork.h') + '</h2>' +
        '<p>' + t('story.paperwork.p1') + '</p>' +
        '<h2>' + t('story.sharing.h') + '</h2>' +
        '<p>' + t('story.sharing.p1') + '</p>' +
      '</section>'
    ));
  }

  /* ================= RESOURCES / FAQ ================= */
  function renderResources(app) {
    var faqGroupsHtml = DATA.faqGroups.map(function (group, gi) {
      var itemsHtml = group.items.map(function (item, ii) {
        // Open the very first question of the very first group by default —
        // it's the one most people need and skip past when everything's collapsed.
        var openAttr = (gi === 0 && ii === 0) ? ' open' : '';
        return '<details class="faq-item"' + openAttr + '><summary>' + escapeHtml(item.q) + '</summary><p>' + escapeHtml(item.a) + '</p></details>';
      }).join('');
      return (
        '<div class="faq-group">' +
          '<h3>' + escapeHtml(group.title) + '</h3>' +
          (group.intro ? '<p class="muted">' + escapeHtml(group.intro) + '</p>' : '') +
          itemsHtml +
        '</div>'
      );
    }).join('');

    var glossaryHtml = DATA.glossary.map(function (item) {
      return '<div class="glossary-item"><dl><dt>' + escapeHtml(item.term) + '</dt><dd>' + escapeHtml(item.definition) + '</dd></dl></div>';
    }).join('');

    var sourcesHtml = DATA.officialSources.map(function (s) {
      return '<li><a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' + escapeHtml(s.label) + '</a></li>';
    }).join('');

    app.appendChild(el(
      '<section>' +
        '<h1>' + escapeHtml(t('res.title')) + '</h1>' +
        '<p class="muted">' + t('res.subtitle') + '</p>' +
        '<div class="section-spacer">' +
          '<h2>' + t('res.faq') + '</h2>' + faqGroupsHtml +
        '</div>' +
        '<div class="section-spacer">' +
          '<h2>' + t('res.glossary') + '</h2>' + glossaryHtml +
        '</div>' +
        '<div class="section-spacer card">' +
          '<h2>' + t('res.sources') + '</h2>' +
          '<p>' + t('res.sourcesBody') + '</p>' +
          '<ul>' + sourcesHtml + '</ul>' +
          '<p class="muted">' + t('res.lastReviewed', { date: escapeHtml(fmtDate(parseDate(DATA.lastVerified)) || DATA.lastVerified) }) + '</p>' +
        '</div>' +
      '</section>'
    ));
  }

  /* ================= WIZARD ================= */
  function getVisibleSteps(answers) {
    // Filter against EFFECTIVE answers, not raw ones: a downstream
    // question's showIf can check a field (e.g. favnDate checks
    // favnDone) whose OWN question is no longer reachable because an
    // earlier answer changed (e.g. rabiesDoses dropped below '2+') —
    // without this, the stale raw value can still satisfy that showIf
    // and the wizard asks a question that's no longer valid to ask.
    var eff = getEffectiveAnswers(answers);
    return DATA.wizard.filter(function (q) { return matches(q.showIf, eff); });
  }

  function isAnswered(q, answers) {
    var val = answers[q.id];
    if (q.type === 'checkboxGroup') return Array.isArray(val) && val.length > 0;
    return val !== undefined && val !== null && val !== '';
  }

  function findResumeIndex(steps, answers) {
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].required && !isAnswered(steps[i], answers)) return i;
    }
    return Math.max(steps.length - 1, 0);
  }

  function renderWizard(app) {
    var answers = loadAnswers();
    var idx = 0;
    var container = el('<div></div>');
    app.appendChild(container);

    function update() {
      var steps = getVisibleSteps(answers);
      if (steps.length === 0) { location.hash = '#/results'; return; }
      if (idx >= steps.length) idx = steps.length - 1;
      if (idx < 0) idx = 0;
      var q = steps[idx];
      var pct = Math.round(((idx + 1) / steps.length) * 100);

      var html =
        '<div class="card" data-question-id="' + escapeHtml(q.id) + '">' +
          '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="progress-label"><span>' + t('wiz.progress', { n: idx + 1, total: steps.length }) + '</span><span>' + pct + '%</span></div>' +
          '<div class="question-label-row">' +
            '<span class="question-label">' + escapeHtml(q.label) + '</span>' +
            (q.why ? '<button type="button" class="why-btn" id="btnWhy" aria-label="' + escapeHtml(t('wiz.whyBtn')) + '" title="' + escapeHtml(t('wiz.whyBtn')) + '">?</button>' : '') +
          '</div>' +
          (q.help ? '<p class="question-help">' + escapeHtml(q.help) + '</p>' : '') +
          '<div id="fieldHost"></div>' +
          '<p class="field-error" style="display:none;color:#b3261e;font-weight:600;margin-top:10px;">' + t('wiz.required') + '</p>' +
          '<div class="wizard-nav">' +
            '<button type="button" class="btn-secondary" id="btnBack">' + t('wiz.back') + '</button>' +
            '<div style="display:flex;gap:10px;align-items:center;">' +
              (!q.required ? '<button type="button" class="skip-link" id="btnSkip">' + t('wiz.skip') + '</button>' : '') +
              '<button type="button" class="btn-primary" id="btnNext">' + (idx === steps.length - 1 ? t('wiz.finish') : t('wiz.next')) + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="wizard-startover-row"><button type="button" class="skip-link start-over-link" id="btnStartOver">' + t('wiz.startOver') + '</button></div>' +
        '</div>';

      container.innerHTML = html;
      renderField(q, answers, container.querySelector('#fieldHost'));

      var whyBtn = container.querySelector('#btnWhy');
      if (whyBtn) {
        whyBtn.addEventListener('click', function () {
          openModal(t('wiz.whyTitle'), el('<div><p>' + escapeHtml(q.why) + '</p></div>'));
        });
      }

      container.querySelector('#btnStartOver').addEventListener('click', function () {
        if (window.confirm(t('wiz.confirmClear'))) {
          localStorage.removeItem(STORAGE_KEYS.answers);
          localStorage.removeItem(STORAGE_KEYS.checked);
          // Already on #/wizard, so re-set the hash would be a no-op
          // (no hashchange fires) — reset the in-memory state directly
          // and re-render instead of navigating.
          answers = {};
          idx = 0;
          update();
        }
      });

      container.querySelector('#btnNext').addEventListener('click', function () {
        if (q.required && !isAnswered(q, answers)) {
          container.querySelector('.field-error').style.display = 'block';
          return;
        }
        saveAnswers(answers);
        if (idx < steps.length - 1) { idx++; update(); }
        else { track('wizard-finished', 'Finished the wizard', true); location.hash = '#/results'; }
      });
      container.querySelector('#btnBack').addEventListener('click', function () {
        if (idx > 0) { idx--; update(); } else { location.hash = '#/home'; }
      });
      var skipBtn = container.querySelector('#btnSkip');
      if (skipBtn) {
        skipBtn.addEventListener('click', function () {
          saveAnswers(answers);
          if (idx < steps.length - 1) { idx++; update(); }
          else { location.hash = '#/results'; }
        });
      }
    }

    var initialSteps = getVisibleSteps(answers);
    idx = findResumeIndex(initialSteps, answers);
    update();
  }

  function renderField(q, answers, host) {
    if (q.type === 'select') {
      var opts = '<option value="">' + t('wiz.choose') + '</option>' + DATA.countries.map(function (c) {
        return '<option value="' + escapeHtml(c.code) + '"' + (answers[q.id] === c.code ? ' selected' : '') + '>' + escapeHtml(c.name) + '</option>';
      }).join('');
      host.appendChild(el('<select id="fieldInput">' + opts + '</select>'));
      host.querySelector('#fieldInput').addEventListener('change', function (e) {
        answers[q.id] = e.target.value;
        saveAnswers(answers);
      });
    } else if (q.type === 'text') {
      var input = el('<input type="text" id="fieldInput" placeholder="' + escapeHtml(q.placeholder || '') + '">');
      input.value = answers[q.id] || '';
      host.appendChild(input);
      input.addEventListener('input', function (e) { answers[q.id] = e.target.value; saveAnswers(answers); });
    } else if (q.type === 'date') {
      var dinput = el('<input type="date" id="fieldInput">');
      dinput.value = answers[q.id] || '';
      host.appendChild(dinput);
      dinput.addEventListener('change', function (e) { answers[q.id] = e.target.value; saveAnswers(answers); });
    } else if (q.type === 'radio') {
      var list = el('<div class="option-list"></div>');
      q.options.forEach(function (opt, i) {
        var checked = answers[q.id] === opt.value;
        // The whole option is a <label> wrapping its <input>, so a click
        // ANYWHERE in the row (padding included) reaches the input via the
        // browser's native label-forwarding, and toggles it exactly once.
        // We only ever listen for the input's 'change' event (fires once
        // no matter how the click was forwarded) — never a 'click' on the
        // row itself, which would double-fire (once from the click that
        // bubbles from the text, once more from the forwarded synthetic
        // click on the input, both reaching the same row ancestor).
        var row = el(
          '<label class="option-item' + (checked ? ' selected' : '') + '">' +
            '<input type="radio" name="fieldInput" value="' + escapeHtml(opt.value) + '"' + (checked ? ' checked' : '') + '>' +
            '<span>' + escapeHtml(opt.label) + '</span>' +
          '</label>'
        );
        row.querySelector('input').addEventListener('change', function () {
          answers[q.id] = opt.value;
          saveAnswers(answers);
          list.querySelectorAll('.option-item').forEach(function (r) { r.classList.remove('selected'); });
          row.classList.add('selected');
        });
        list.appendChild(row);
      });
      host.appendChild(list);
    } else if (q.type === 'checkboxGroup') {
      var current = Array.isArray(answers[q.id]) ? answers[q.id].slice() : [];
      var glist = el('<div class="option-list"></div>');
      q.options.forEach(function (opt, i) {
        var checked = current.indexOf(opt.value) !== -1;
        // See note above on the radio branch: the whole row is a <label>
        // wrapping its <input>, and we only ever listen on the input's
        // 'change' event — never a 'click' on the row (which would double-fire).
        var row = el(
          '<label class="option-item' + (checked ? ' selected' : '') + '">' +
            '<input type="checkbox" value="' + escapeHtml(opt.value) + '"' + (checked ? ' checked' : '') + '>' +
            '<span>' + escapeHtml(opt.label) + '</span>' +
          '</label>'
        );
        row.querySelector('input').addEventListener('change', function (e) {
          var willCheck = e.target.checked;
          if (opt.exclusive) {
            current = willCheck ? [opt.value] : [];
          } else {
            var exclusiveOpt = q.options.filter(function (o) { return o.exclusive; })[0];
            if (exclusiveOpt) current = current.filter(function (v) { return v !== exclusiveOpt.value; });
            if (willCheck) {
              if (current.indexOf(opt.value) === -1) current.push(opt.value);
            } else {
              current = current.filter(function (v) { return v !== opt.value; });
            }
          }
          answers[q.id] = current;
          saveAnswers(answers);
          glist.querySelectorAll('.option-item').forEach(function (r, ri) {
            var val = q.options[ri].value;
            var isOn = current.indexOf(val) !== -1;
            r.classList.toggle('selected', isOn);
            r.querySelector('input').checked = isOn;
          });
        });
        glist.appendChild(row);
      });
      host.appendChild(glist);
    }
  }

  /* ================= MODAL (export / import / about / donate) ================= */
  var activeModalClose = null;
  function openModal(title, bodyEl) {
    if (activeModalClose) activeModalClose(); // only ever one popup at a time
    var overlay = el('<div class="modal-overlay"></div>');
    var modal = el(
      '<div class="modal-card" role="dialog" aria-modal="true">' +
        '<div class="modal-header"><h3></h3><button type="button" class="modal-close" aria-label="Close">&times;</button></div>' +
        '<div class="modal-body"></div>' +
      '</div>'
    );
    modal.querySelector('h3').textContent = title;
    modal.querySelector('.modal-body').appendChild(bodyEl);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (activeModalClose === close) activeModalClose = null;
    }
    activeModalClose = close;
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    modal.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    return { close: close, modal: modal };
  }

  function copyTextToClipboard(text, onDone) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { onDone(true); }, function () { onDone(false); });
      return;
    }
    // Fallback for browsers/contexts without the async Clipboard API.
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      onDone(!!ok);
    } catch (e) {
      onDone(false);
    }
  }

  function downloadBlob(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function downloadTextAsFile(filename, text) {
    downloadBlob(filename, new Blob([text], { type: 'application/json' }));
  }

  /* ================= checklist image / single-page PDF export =================
     Renders the results content (everything except the action buttons
     themselves) to a canvas via the vendored html2canvas, then either
     downloads that directly as a PNG or wraps it in a hand-built minimal
     single-page PDF. Deliberately NOT window.print(): that's what the
     existing "Print / Save as PDF" button already does (and paginates,
     per the maintainer's own complaint) — this is a genuinely different,
     one-click direct file download, everything on one long image/page. */
  function captureResultsCanvas() {
    if (typeof window.html2canvas !== 'function') {
      return Promise.reject(new Error(t('export.libMissing')));
    }
    var target = document.getElementById('app');
    var bg = getComputedStyle(document.body).backgroundColor;
    return window.html2canvas(target, {
      backgroundColor: bg,
      useCORS: true,
      scale: Math.min(2, window.devicePixelRatio || 1),
      ignoreElements: function (node) { return !!(node.classList && node.classList.contains('results-actions')); }
    });
  }

  function exportFilenameBase() {
    var a = loadAnswers();
    return 'port-dog-checklist' + (a.dogName ? '-' + a.dogName.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '');
  }

  function downloadResultsAsPng() {
    return captureResultsCanvas().then(function (canvas) {
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (!blob) { reject(new Error(t('export.imageFailed'))); return; }
          downloadBlob(exportFilenameBase() + '.png', blob);
          resolve();
        }, 'image/png');
      });
    });
  }

  function stringToBytes(str) {
    var bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    return bytes;
  }
  function dataUrlToBytes(dataUrl) {
    var base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function pad10(n) {
    var s = String(Math.round(n));
    while (s.length < 10) s = '0' + s;
    return s;
  }

  /* Hand-built rather than a second vendored PDF library: embedding one
     JPEG on one page is a tiny, well-defined slice of the PDF spec (an
     XObject Image with Filter /DCTDecode holds the JPEG bytes completely
     unmodified — no re-encoding needed), so doing it directly avoids a
     second ~300KB+ dependency for what is a very small amount of actual
     structure. Every xref entry is exactly 20 bytes as the spec requires
     — verified against `qpdf --check` and by rendering with `pdftoppm`
     during development, not just visual inspection. */
  function buildSingleImagePdf(jpegBytes, pxWidth, pxHeight, ptWidth, ptHeight) {
    var parts = [];
    var pos = 0;
    var offsets = [];
    function add(part) { parts.push(part); pos += part.length; }
    function beginObj(num) { offsets[num] = pos; add(stringToBytes(num + ' 0 obj\n')); }
    function endObj() { add(stringToBytes('endobj\n')); }

    add(stringToBytes('%PDF-1.4\n'));

    beginObj(1);
    add(stringToBytes('<< /Type /Catalog /Pages 2 0 R >>\n'));
    endObj();

    beginObj(2);
    add(stringToBytes('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n'));
    endObj();

    beginObj(3);
    add(stringToBytes(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + ptWidth + ' ' + ptHeight + ']' +
      ' /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\n'
    ));
    endObj();

    beginObj(4);
    add(stringToBytes(
      '<< /Type /XObject /Subtype /Image /Width ' + pxWidth + ' /Height ' + pxHeight +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpegBytes.length + ' >>\nstream\n'
    ));
    add(jpegBytes);
    add(stringToBytes('\nendstream\n'));
    endObj();

    var content = 'q ' + ptWidth + ' 0 0 ' + ptHeight + ' 0 0 cm /Im0 Do Q';
    beginObj(5);
    add(stringToBytes('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\n'));
    endObj();

    var xrefStart = pos;
    var xref = 'xref\n0 6\n0000000000 65535 f\r\n';
    for (var n = 1; n <= 5; n++) xref += pad10(offsets[n]) + ' 00000 n\r\n';
    add(stringToBytes(xref));
    add(stringToBytes('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF'));

    var total = 0;
    parts.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total);
    var off = 0;
    parts.forEach(function (p) { out.set(p, off); off += p.length; });
    return out;
  }

  function downloadResultsAsPdf() {
    var target = document.getElementById('app');
    var cssWidth = target.offsetWidth;
    var cssHeight = target.scrollHeight;
    return captureResultsCanvas().then(function (canvas) {
      var jpegBytes = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92));
      var ptWidth = Math.round(cssWidth * 0.75);
      var ptHeight = Math.round(cssHeight * 0.75);
      var pdfBytes = buildSingleImagePdf(jpegBytes, canvas.width, canvas.height, ptWidth, ptHeight);
      downloadBlob(exportFilenameBase() + '.pdf', new Blob([pdfBytes], { type: 'application/pdf' }));
    });
  }

  function withExportButton(btn, workFn) {
    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('export.busy');
    workFn().catch(function (err) {
      window.alert(t('export.failed', { error: err && err.message ? err.message : err }));
    }).then(function () {
      btn.disabled = false;
      btn.textContent = original;
    });
  }

  function buildExportPayload() {
    return {
      pawportExport: true,
      version: DATA_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      answers: loadAnswers(),
      checked: loadChecked()
    };
  }

  function openExportModal() {
    var payload = buildExportPayload();
    var json = JSON.stringify(payload, null, 2);
    var filename = 'port-dog-checklist' + (payload.answers.dogName ? '-' + payload.answers.dogName.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '') + '.json';

    var body = el(
      '<div>' +
        '<p>' + (payload.answers.dogName ? t('export.introDog', { dog: escapeHtml(payload.answers.dogName) }) : t('export.intro')) + '</p>' +
        '<button type="button" class="btn-primary" id="btnDownloadJson">' + t('export.download') + '</button>' +
        '<div class="modal-divider">' + t('export.orCopy') + '</div>' +
        '<textarea class="json-textarea" id="exportTextarea" readonly></textarea>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" id="btnCopyJson">' + t('export.copy') + '</button>' +
        '</div>' +
        '<div class="modal-status" id="exportStatus"></div>' +
      '</div>'
    );
    body.querySelector('#exportTextarea').value = json;

    var handle = openModal(t('export.title'), body);
    body.querySelector('#btnDownloadJson').addEventListener('click', function () {
      downloadTextAsFile(filename, json);
    });
    body.querySelector('#btnCopyJson').addEventListener('click', function () {
      copyTextToClipboard(json, function (ok) {
        var status = body.querySelector('#exportStatus');
        status.textContent = ok ? t('export.copied') : t('export.copyFailed');
        status.className = 'modal-status ' + (ok ? 'ok' : 'err');
      });
    });
    body.querySelector('#exportTextarea').addEventListener('click', function (e) { e.target.select(); });
  }

  function applyImportedPayload(parsed) {
    if (!parsed || typeof parsed.answers !== 'object' || !parsed.answers) {
      throw new Error(t('import.notExport'));
    }
    // migrateAnswers + sanitizeAnswers together mean an export from an
    // older or newer app version, a different device, or a hand-edited
    // file can never crash the import or leave garbage behind — anything
    // that no longer matches the currently loaded question set is simply
    // dropped, not kept as stale data.
    saveAnswers(sanitizeAnswers(migrateAnswers(parsed)));
    saveChecked(sanitizeChecked(parsed.checked));
    return parsed.version !== DATA_SCHEMA_VERSION;
  }

  function openImportModal() {
    var body = el(
      '<div>' +
        '<p>' + t('import.intro') + '</p>' +
        '<label class="file-drop-label" id="fileDropLabel">' + t('import.choose') + '<input type="file" accept="application/json,.json" id="importFileInput"></label>' +
        '<div class="modal-divider">' + t('import.orPaste') + '</div>' +
        '<textarea class="json-textarea" id="importTextarea" placeholder="' + escapeHtml(t('import.placeholder')) + '"></textarea>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-primary" id="btnImportPasted">' + t('import.button') + '</button>' +
        '</div>' +
        '<div class="modal-status" id="importStatus"></div>' +
      '</div>'
    );

    var handle = openModal(t('import.title'), body);
    var statusEl = body.querySelector('#importStatus');

    function finishImport(rawText) {
      try {
        var parsed = JSON.parse(rawText);
        var versionMismatch = applyImportedPayload(parsed);
        statusEl.textContent = t('import.done') + (versionMismatch ? ' ' + t('import.versionNote') : '');
        statusEl.className = 'modal-status ok';
        setTimeout(function () {
          handle.close();
          if (location.hash === '#/results') navigate();
          else location.hash = '#/results';
        }, 500);
      } catch (err) {
        statusEl.textContent = t('import.failed', { error: err.message });
        statusEl.className = 'modal-status err';
      }
    }

    body.querySelector('#importFileInput').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { finishImport(String(reader.result || '')); };
      reader.onerror = function () {
        statusEl.textContent = t('import.readFailed');
        statusEl.className = 'modal-status err';
      };
      reader.readAsText(file);
    });
    body.querySelector('#btnImportPasted').addEventListener('click', function () {
      var text = body.querySelector('#importTextarea').value.trim();
      if (!text) {
        statusEl.textContent = t('import.pasteFirst');
        statusEl.className = 'modal-status err';
        return;
      }
      finishImport(text);
    });
  }

  /* ================= RESULTS ================= */
  function renderResults(app) {
    var answers = loadAnswers();
    if (!answers.originCountry) {
      var emptyCard = el(
        '<div class="card">' +
          '<h2>' + t('results.emptyTitle') + '</h2>' +
          '<p>' + t('results.emptyBody') + '</p>' +
          '<div class="cta-row" style="justify-content:flex-start;">' +
            '<a href="#/wizard" class="btn-primary" data-nav>' + t('results.emptyStart') + '</a>' +
            '<button type="button" class="btn-secondary" id="btnImportEmpty">' + t('results.emptyImport') + '</button>' +
          '</div>' +
        '</div>'
      );
      app.appendChild(emptyCard);
      emptyCard.querySelector('#btnImportEmpty').addEventListener('click', openImportModal);
      return;
    }

    var country = countriesByCode[answers.originCountry] || { name: t('results.yourCountry'), designated: false };
    var checked = loadChecked();
    var eff = getEffectiveAnswers(answers);
    var dates = computeAllDates(eff);
    var visibleItems = DATA.checklistItems.filter(function (item) { return matches(item.showIf, eff); });
    var alerts = computeFeasibilityAlerts(eff, dates, country, todayDateOnly());

    var doneCount = visibleItems.filter(function (item) { return checked[item.id]; }).length;
    var totalCount = visibleItems.length;
    var pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;


    if (alerts.length) {
      var alertsHtml = alerts.map(function (a) {
        var icon = a.level === 'blocker' ? '🚫' : '⚠️';
        return '<div class="feasibility-alert level-' + a.level + '">' +
          '<div class="feasibility-alert-icon">' + icon + '</div>' +
          '<div><div class="feasibility-alert-title">' + escapeHtml(a.title) + '</div>' +
          '<div class="feasibility-alert-body">' + escapeHtml(a.detail) + '</div></div>' +
        '</div>';
      }).join('');
      app.appendChild(el('<div class="feasibility-banner">' + alertsHtml + '</div>'));
    }

    var header = el(
      '<div class="results-header">' +
        '<h1>' + (answers.dogName ? t('results.titleDog', { dog: escapeHtml(answers.dogName) }) : t('results.title')) + '</h1>' +
        '<p class="muted">' + t('results.from', { country: escapeHtml(country.name) }) + (answers.dogBreed ? ' &middot; ' + escapeHtml(answers.dogBreed) : '') + '</p>' +
      '</div>'
    );
    app.appendChild(header);

    if (country.designated) {
      app.appendChild(el(
        '<div class="designated-banner">' +
          t('results.designated', { country: escapeHtml(country.name) }) +
        '</div>'
      ));
    }

    var progressWrap = el(
      '<div class="progress-summary">' +
        '<div style="flex:1;">' +
          '<div class="progress-track"><div class="progress-fill" id="resultsProgressFill" style="width:' + pct + '%"></div></div>' +
        '</div>' +
        '<div class="progress-circle-label" id="resultsProgressLabel">' + t('results.done', { done: doneCount, total: totalCount }) + '</div>' +
      '</div>'
    );
    app.appendChild(progressWrap);

    var actions = el(
      '<div class="results-actions">' +
        '<button type="button" class="btn-secondary" id="btnPrint">' + t('results.print') + '</button>' +
        '<button type="button" class="btn-secondary" id="btnDownloadPng">' + t('results.png') + '</button>' +
        '<button type="button" class="btn-secondary" id="btnDownloadPdf">' + t('results.pdf') + '</button>' +
        '<a href="#/wizard" class="btn-secondary" data-nav>' + t('results.edit') + '</a>' +
        '<button type="button" class="btn-secondary" id="btnExport">' + t('results.export') + '</button>' +
        '<button type="button" class="btn-secondary" id="btnImport">' + t('results.import') + '</button>' +
        '<button type="button" class="btn-secondary" id="btnStartOver">' + t('wiz.startOver') + '</button>' +
      '</div>'
    );
    app.appendChild(actions);
    actions.querySelector('#btnPrint').addEventListener('click', function () { window.print(); });
    actions.querySelector('#btnDownloadPng').addEventListener('click', function () {
      withExportButton(this, downloadResultsAsPng);
    });
    actions.querySelector('#btnDownloadPdf').addEventListener('click', function () {
      withExportButton(this, downloadResultsAsPdf);
    });
    actions.querySelector('#btnExport').addEventListener('click', openExportModal);
    actions.querySelector('#btnImport').addEventListener('click', openImportModal);
    actions.querySelector('#btnStartOver').addEventListener('click', function () {
      if (window.confirm(t('wiz.confirmClear'))) {
        localStorage.removeItem(STORAGE_KEYS.answers);
        localStorage.removeItem(STORAGE_KEYS.checked);
        location.hash = '#/wizard';
      }
    });

    DATA.categories.forEach(function (cat) {
      var itemsInCat = visibleItems.filter(function (i) { return i.category === cat.id; });
      if (!itemsInCat.length) return;

      var block = el(
        '<div class="category-block">' +
          '<div class="category-title"><span>' + cat.icon + '</span><h2>' + escapeHtml(cat.title) + '</h2></div>' +
          '<p class="category-blurb">' + escapeHtml(cat.blurb) + '</p>' +
          '<div class="card item-list"></div>' +
        '</div>'
      );
      var list = block.querySelector('.item-list');

      itemsInCat.forEach(function (item) {
        var isDone = !!checked[item.id];
        var body = item.body;
        if (item.countryNote) {
          var detail = (DATA.countryDetails[country.code] && DATA.countryDetails[country.code][item.id])
            || (DATA.countryDetails.default && DATA.countryDetails.default[item.id]);
          if (detail) {
            body += '<br><br><strong>' + t('results.specificTo', { country: escapeHtml(country.name) }) + '</strong> ' + escapeHtml(detail);
          }
        }
        // Already told us this is done — don't show a "submit by" deadline
        // callout for something already handled; confirm it instead.
        var alreadyNotifiedAqs = item.id === 'advance-notification' && eff.aqsNotified === 'yes';
        if (alreadyNotifiedAqs) {
          var notifiedDateForItem = parseDate(eff.aqsNotifiedDate);
          body += '<br><br>' + (notifiedDateForItem ? t('results.aqsDoneOn', { date: escapeHtml(fmtDate(notifiedDateForItem)) }) : t('results.aqsDone'));
        }
        var dateCalloutHtml = '';
        if (item.computedDate && dates[item.computedDate] && !alreadyNotifiedAqs) {
          var dc = dates[item.computedDate];
          dateCalloutHtml = '<div class="date-callout">' + escapeHtml(dc.label) + ': <span class="value">' + fmtDate(dc.value) + '</span>' +
            (dc.note ? '<div class="muted" style="font-weight:400;margin-top:4px;">' + escapeHtml(dc.note) + '</div>' : '') +
            '</div>';
        }

        var row = el(
          '<div class="checklist-item' + (isDone ? ' done' : '') + '" data-item-id="' + item.id + '">' +
            '<input type="checkbox"' + (isDone ? ' checked' : '') + '>' +
            '<div style="flex:1;">' +
              '<div class="item-title">' + escapeHtml(item.title) + '</div>' +
              '<div class="item-body">' + body + dateCalloutHtml + '</div>' +
            '</div>' +
          '</div>'
        );

        function toggle() {
          checked[item.id] = !checked[item.id];
          saveChecked(checked);
          row.classList.toggle('done', !!checked[item.id]);
          row.querySelector('input').checked = !!checked[item.id];
          var newDone = visibleItems.filter(function (i) { return checked[i.id]; }).length;
          var newPct = totalCount ? Math.round((newDone / totalCount) * 100) : 0;
          document.getElementById('resultsProgressFill').style.width = newPct + '%';
          document.getElementById('resultsProgressLabel').textContent = t('results.done', { done: newDone, total: totalCount });
        }
        row.querySelector('input').addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
        row.querySelector('.item-title').addEventListener('click', toggle);

        list.appendChild(row);
      });

      app.appendChild(block);
    });

    var cs = DATA.caseStudy;
    if (cs) {
      app.appendChild(el(
        '<div class="story-callout section-spacer">' +
          '<h2>' + escapeHtml(cs.title) + '</h2>' +
          '<p>' + escapeHtml(cs.summary) + '</p>' +
        '</div>'
      ));
    }
  }

  /* ================= header fit =================
     CSS breakpoints handle the usual cases, but translated labels vary a
     lot in length (German/Russian run long), so as a backstop: if the
     inline nav doesn't fit on one row, collapse it into the hamburger
     menu. Nav text is nowrap, so "doesn't fit" shows up as overflow. */
  function fitHeader() {
    var header = document.querySelector('.site-header');
    var row = header && header.querySelector('.header-row');
    if (!row) return;
    function fits() { return row.scrollWidth <= row.clientWidth + 1; }
    // Degrade step by step and stop as soon as everything fits: the nav
    // links (especially "Build my checklist") must stay visible whenever
    // there's any way to fit them — collapsing into the menu is last.
    header.classList.remove('hdr-icons', 'hdr-tight', 'nav-compact');
    if (fits()) return;
    header.classList.add('hdr-icons');   // Donate / theme buttons icon-only
    if (fits()) return;
    header.classList.add('hdr-tight');   // tighter gaps and button padding
    if (fits()) return;
    header.classList.add('nav-compact'); // last resort: hamburger menu
  }
  var fitQueued = false;
  function queueFitHeader() {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(function () { fitQueued = false; fitHeader(); });
  }

  /* ================= static shell text + language picker ================= */
  function localizeStatic() {
    document.documentElement.lang = LANG === 'zh' ? 'zh-Hans' : LANG;
    document.title = t('meta.title');
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.innerHTML = t(n.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (n) {
      var v = t(n.getAttribute('data-i18n-aria'));
      n.setAttribute('aria-label', v);
      n.title = v;
    });
    var info = langInfo(LANG);
    document.getElementById('langFlag').src = 'assets/flags/' + info.flag + '.svg';
    document.getElementById('langCode').textContent = info.code.toUpperCase();
    var lb = document.getElementById('langBtn');
    lb.setAttribute('aria-label', t('lang.button', { language: info.name }));
    lb.title = t('lang.title');
    var notice = document.getElementById('langNotice');
    if (LANG !== 'en') {
      notice.innerHTML = '<span>🌐 ' + t('i18n.notice') + '</span> <button type="button" class="link-btn" id="btnReadEnglish" lang="en">' + t('i18n.readEnglish') + '</button>';
      notice.hidden = false;
      document.getElementById('btnReadEnglish').addEventListener('click', function () { setLang('en'); });
    }
  }

  function wireLangPicker() {
    var btn = document.getElementById('langBtn');
    var menu = document.getElementById('langMenu');
    function options() { return Array.prototype.slice.call(menu.querySelectorAll('.lang-option')); }
    function build() {
      I18N.LANGS.forEach(function (L) {
        var opt = el(
          '<button type="button" class="lang-option" role="menuitemradio" lang="' + L.code + '" aria-checked="' + (L.code === LANG) + '">' +
            '<img src="assets/flags/' + L.flag + '.svg" alt="" width="24" height="18">' +
            '<span class="lang-names"><span class="lang-native">' + escapeHtml(L.name) + '</span>' +
              (L.name !== L.english ? '<span class="lang-english" lang="en">' + escapeHtml(L.english) + '</span>' : '') + '</span>' +
            '<span class="lang-option-code">' + L.code.toUpperCase() + '</span>' +
          '</button>'
        );
        opt.addEventListener('click', function () { if (L.code !== LANG) setLang(L.code); else close(); });
        menu.appendChild(opt);
      });
    }
    function open() {
      if (!menu.firstChild) build(); // built on first open, so the flag images only load if needed
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      var cur = menu.querySelector('[aria-checked="true"]') || options()[0];
      cur.focus();
    }
    function close() {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target)) close();
    });
    menu.addEventListener('keydown', function (e) {
      var opts = options();
      var i = opts.indexOf(document.activeElement);
      if (e.key === 'Escape') { close(); btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); opts[(i + 1) % opts.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); opts[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); opts[opts.length - 1].focus(); }
      else if (e.key === 'Tab') { close(); }
    });
  }

  /* ================= nav wiring ================= */
  function wireChrome() {
    localizeStatic();
    wireLangPicker();
    document.getElementById('navToggle').addEventListener('click', function () {
      var nav = document.getElementById('siteNav');
      var open = nav.classList.toggle('open');
      document.getElementById('navToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    wireThemeToggle();
    document.getElementById('aboutBtn').addEventListener('click', openAboutModal);
    document.getElementById('donateBtn').addEventListener('click', openDonateModal);
    // Outbound clicks worth knowing about (counted, never blocked).
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      if (a.getAttribute('href') === DONATE_URL) track('donate-paypal-click', 'Clicked through to PayPal', true);
      else if (a.getAttribute('href') === LINKEDIN_URL) track('maker-linkedin-click', 'Opened the maker\'s LinkedIn', true);
    });
    var gcScript = document.getElementById('gcScript');
    if (gcScript) gcScript.addEventListener('load', flushTracking);
    flushTracking();
    trackLanguageOnce();
    // Footer (and any other) triggers, by data attribute.
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-open-donate], [data-open-about]');
      if (!t) return;
      e.preventDefault();
      if (t.hasAttribute('data-open-donate')) openDonateModal(); else openAboutModal();
    });
    loadBuildInfo();
    fitHeader();
    window.addEventListener('resize', queueFitHeader);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHeader);
  }

  /* ================= build/publish stamp =================
     There's no build step for this site, so this asks GitHub directly
     for the latest commit on main and derives both the published time
     and the commit hash from that — always accurate when it works,
     nothing to remember to update. BUT GitHub's unauthenticated API is
     capped at 60 requests/hour per IP, and that's shared across
     whatever NAT/proxy pool a visitor's traffic happens to sit behind
     — real visitors can and do land on an already-exhausted IP, and a
     silent failure there left the footer showing a bare "—" once.
     So: try the live fetch first for accuracy, but always fall back
     to the values baked into checklist-data.json (fallbackCommitHash /
     fallbackPublishedAt — bump these by hand alongside each deploy,
     same as the ?v= cache-bust numbers) so a real visitor never sees
     an empty stamp, just a very slightly stale one in the rare case
     the live fetch fails. */
  function renderBuildInfo(sha, isoDate) {
    var publishedEl = document.getElementById('publishedAt');
    var hashLink = document.getElementById('buildHashLink');
    if (publishedEl && isoDate) {
      var d = new Date(isoDate);
      if (!isNaN(d.getTime())) {
        var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        publishedEl.textContent = d.toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }) + ' (' + tz + ')';
      }
    }
    if (hashLink && sha) {
      hashLink.textContent = sha.slice(0, 7);
      hashLink.href = 'https://github.com/njmurarka/pawport/commit/' + sha;
    }
  }
  function loadBuildInfo() {
    if (DATA) renderBuildInfo(DATA.fallbackCommitHash, DATA.fallbackPublishedAt);
    fetch('https://api.github.com/repos/njmurarka/pawport/commits/main')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.sha) return;
        var commitDate = data.commit && data.commit.committer && data.commit.committer.date;
        renderBuildInfo(data.sha, commitDate);
      })
      .catch(function () { /* offline or rate-limited — the fallback stamp set above stands */ });
  }

  /* ================= init ================= */
  function init() {
    // ?v= bumped by hand alongside checklist-data.json edits, same
    // reasoning as the ?v= on the css/js tags in index.html.
    fetch('data/checklist-data.json?v=24')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        DATA = data;
        if (LANG === 'en') return null;
        return fetch('data/i18n/' + LANG + '.json?v=' + I18N_VERSION)
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      })
      .then(function (overlay) {
        if (overlay) I18N.applyOverlay(DATA, overlay);
        else if (LANG !== 'en') { LANG = 'en'; LOCALE = 'en'; } // language file unavailable: stay fully English
        DATA.countries.forEach(function (c) { countriesByCode[c.code] = c; });
        wireChrome();
        navigate();
        window.addEventListener('hashchange', navigate);
      })
      .catch(function (err) {
        document.getElementById('app').innerHTML =
          '<div class="card"><h2>' + t('error.load') + '</h2><p class="muted">' + escapeHtml(err && err.message) + '</p></div>';
        console.error(err);
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
