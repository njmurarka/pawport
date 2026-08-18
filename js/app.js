(function () {
  'use strict';

  var STORAGE_KEYS = { answers: 'pawport_answers_v1', checked: 'pawport_checked_v1' };
  var DATA = null;
  var countriesByCode = {};

  /* ================= storage ================= */
  function loadAnswers() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.answers)) || {}; }
    catch (e) { return {}; }
  }
  function saveAnswers(a) {
    try { localStorage.setItem(STORAGE_KEYS.answers, JSON.stringify(a)); } catch (e) {}
  }
  function loadChecked() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.checked)) || {}; }
    catch (e) { return {}; }
  }
  function saveChecked(c) {
    try { localStorage.setItem(STORAGE_KEYS.checked, JSON.stringify(c)); } catch (e) {}
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
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function todayDateOnly() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }

  /* ================= effective answers =================
     Japan only counts a rabies vaccination (and everything downstream —
     titer test, FAVN) if it happened after the microchip was implanted.
     If the dog doesn't have a chip yet (or the owner isn't sure), any
     rabiesDoses/favnDone/dates the wizard collected for a *previous*
     microchipDone answer are stale and must not drive the checklist —
     treat the vaccination chain as not-yet-started instead of asking a
     nonsensical "how many since the chip" question in that case. */
  function getEffectiveAnswers(answers) {
    var eff = {};
    for (var k in answers) { if (Object.prototype.hasOwnProperty.call(answers, k)) eff[k] = answers[k]; }
    if (eff.microchipDone !== 'yes') {
      eff.rabiesDoses = '0';
      eff.favnDone = 'no';
      eff.lastRabiesDate = undefined;
      eff.rabiesDuration = undefined;
      eff.favnDate = undefined;
    }
    return eff;
  }

  function computeAllDates(answers) {
    var out = {};
    var favnDate = parseDate(answers.favnDate);
    var travelDate = parseDate(answers.travelDate);
    var lastRabiesDate = parseDate(answers.lastRabiesDate);

    if (favnDate) {
      out.favn180 = { label: 'Earliest possible travel date', value: addDays(favnDate, 180) };
      var validityEnd = addYears(favnDate, 2);
      out.favnValidityEnd = { label: 'FAVN 2-year outer validity ends', value: validityEnd };
      var trueDeadline = addDays(validityEnd, -180);
      var bufferDeadline = addDays(trueDeadline, -7);
      out.favnRedrawDeadline = {
        label: 'Suggested FAVN redraw-by date (1-week buffer)',
        value: bufferDeadline,
        note: 'True no-gap deadline: ' + fmtDate(trueDeadline) + '. A late redraw is a soft failure — you just wait out a new 180-day clock — so a modest buffer is enough.'
      };
    }
    if (lastRabiesDate && answers.rabiesDuration && answers.rabiesDuration !== 'unsure') {
      var years = answers.rabiesDuration === '1yr' ? 1 : 3;
      var bufferDays = answers.rabiesDuration === '1yr' ? 21 : 40;
      var dueDate = addYears(lastRabiesDate, years);
      var bufferDate = addDays(dueDate, -bufferDays);
      out.boosterBufferDate = {
        label: 'Suggested booster-by date (safety buffer)',
        value: bufferDate,
        note: 'Labeled immunity runs out ' + fmtDate(dueDate) + '. Missing this resets everything (new vaccination series + new FAVN + new 180-day wait), so we build in a bigger buffer: at least ' + bufferDays + ' days.'
      };
    }
    if (travelDate) {
      out.advanceNotificationDeadline = { label: 'Submit AQS advance notification by', value: addDays(travelDate, -40) };
      out.preExportExamWindow = {
        label: 'Pre-export exam window opens',
        value: addDays(travelDate, -10),
        note: 'Any time from ' + fmtDate(addDays(travelDate, -10)) + ' through your travel date.'
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
        if (dates.favn180) { earliestTravel = dates.favn180.value; basisNote = 'from your FAVN blood draw date'; }
      } else {
        var earliestDraw = computeEarliestFavnDrawDate(eff, today);
        earliestTravel = addDays(earliestDraw, 180);
        basisNote = 'in the best case, assuming every remaining vet step happens with no delay';
      }

      if (earliestTravel && travelDate && travelDate < earliestTravel) {
        alerts.push({
          level: 'blocker',
          title: 'Your target travel date is not achievable',
          detail: 'Japan requires a mandatory 180-day wait after the FAVN blood draw, with no exceptions. Based on your answers, the earliest your dog could legally enter Japan is ' + fmtDate(earliestTravel) + ' (' + basisNote + ') — ' + daysBetween(travelDate, earliestTravel) + ' day(s) after your stated travel date of ' + fmtDate(travelDate) + '. Your dog cannot travel with you on this date — you need to push your trip back.'
        });
      }

      if (eff.favnDone === 'yes' && dates.favnValidityEnd && travelDate && travelDate > dates.favnValidityEnd.value) {
        alerts.push({
          level: 'blocker',
          title: 'Your FAVN result will have expired before your travel date',
          detail: 'Your FAVN is only valid for 2 years from the blood draw, until ' + fmtDate(dates.favnValidityEnd.value) + '. Your stated travel date of ' + fmtDate(travelDate) + ' is after that. You need a new blood draw — and a fresh 180-day wait — before you can travel.'
        });
      }

      var lastRabies = parseDate(eff.lastRabiesDate);
      var years = eff.rabiesDuration === '1yr' ? 1 : (eff.rabiesDuration === '3yr' ? 3 : null);
      if (lastRabies && years) {
        var dueDate = addYears(lastRabies, years);
        if (dueDate < today) {
          alerts.push({
            level: 'blocker',
            title: 'Your rabies vaccine coverage has already lapsed',
            detail: 'Your last rabies vaccination’s labeled immunity period ended ' + fmtDate(dueDate) + '. A lapse invalidates your FAVN result entirely — Japan will require a brand-new vaccination series, a new FAVN blood draw, and a fresh 180-day wait from scratch.'
          });
        } else if (travelDate && dueDate < travelDate) {
          alerts.push({
            level: 'blocker',
            title: 'Your rabies vaccine coverage will lapse before your travel date',
            detail: 'Your current vaccination’s labeled immunity runs out ' + fmtDate(dueDate) + ', which is before your stated travel date of ' + fmtDate(travelDate) + '. You must get a booster before that date to keep your FAVN result valid — missing it resets the whole process.'
          });
        }
      }
    }

    if (dates.advanceNotificationDeadline && today > dates.advanceNotificationDeadline.value) {
      alerts.push({
        level: 'urgent',
        title: 'You are past the 40-day advance-notification deadline',
        detail: 'Japan’s Animal Quarantine Service requires advance notification at least 40 days before arrival. Based on your travel date, that deadline was ' + fmtDate(dates.advanceNotificationDeadline.value) + '. Contact the AQS office at your port of entry immediately if you haven’t already notified them — being this late risks delays or denial at arrival.'
      });
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
        '<span class="tag">Free &middot; No account needed &middot; Works on your phone</span>' +
        '<h1>Your dog’s path to Japan, mapped out step by step.</h1>' +
        '<p class="lede">Bringing a dog into Japan involves microchips, blood tests, strict deadlines, and government paperwork — in an order that matters. This tool turns all of that into a personalized checklist for your situation, built from real experience so you don’t have to learn every lesson the hard way.</p>' +
        '<div class="cta-row">' +
          '<a href="#/wizard" class="btn-primary" data-nav>Build my checklist &rarr;</a>' +
          '<a href="#/resources" class="btn-secondary" data-nav>Browse the FAQ first</a>' +
        '</div>' +
        '<p class="muted"><button type="button" class="skip-link" id="btnImportHome">Already started on another device? Import your checklist &rarr;</button></p>' +
      '</section>'
    ));
    document.getElementById('btnImportHome').addEventListener('click', openImportModal);

    app.appendChild(el(
      '<section class="feature-grid">' +
        '<div class="feature-card"><span class="icon">🧭</span><h3>Personalized, not generic</h3><p>Answer a few plain-language questions about your dog and your country, and get a checklist tailored to your exact situation — including the simplified path if you’re coming from one of the handful of rabies-free “designated regions.”</p></div>' +
        '<div class="feature-card"><span class="icon">⏳</span><h3>The deadlines, calculated for you</h3><p>The FAVN blood test’s 180-day wait, its 2-year outer limit, and safe booster timing all get worked out automatically from your dates — including safety buffers sized to how bad it is if you miss them.</p></div>' +
        '<div class="feature-card"><span class="icon">✅</span><h3>A checklist you actually check off</h3><p>Track your progress, print it, or come back later — your answers and progress are saved right on your device.</p></div>' +
      '</section>'
    ));

    app.appendChild(el(
      '<section class="story-callout">' +
        '<h2>Why this exists</h2>' +
        '<p>This app exists because someone went through this process for real — the confusing forms, the vet visits, the conflicting advice, the deadlines that quietly reset to zero if you get them wrong — and wanted to spare the next person some of that stress. It’s a work in progress, and it’ll keep improving as more people share what they learn.</p>' +
        '<p><a href="#/about" data-nav>Read the full story &rarr;</a></p>' +
      '</section>'
    ));

    app.appendChild(el(
      '<section class="card">' +
        '<h2>Before you dive in</h2>' +
        '<p>This tool focuses on <strong>dogs</strong> traveling <strong>to Japan</strong> from anywhere else in the world. It’s built and maintained by pet owners, not lawyers or vets — always confirm current, exact requirements with your own veterinarian, your country’s export authority, and Japan’s Animal Quarantine Service before you travel. Rules can and do change.</p>' +
      '</section>'
    ));
  }

  /* ================= ABOUT ================= */
  function renderAbout(app) {
    app.appendChild(el(
      '<section class="card">' +
        '<h1>Our story</h1>' +
        '<p class="muted">This account is accurate to our actual timeline, including real dates. We’ve left out city, clinic, and personal names — everything else here happened as described.</p>' +

        '<h2>How it started</h2>' +
        '<p>On March 24, 2026, our vet in Canada implanted an ISO-compliant microchip, gave the first rabies vaccination, and drew blood for the antibody test Japan requires — all in one visit. That single date became the anchor for everything downstream: a 180-day minimum wait before travel, a 2-year outer limit on the test result, and a chain of booster and retest deadlines that all trace back to it.</p>' +
        '<p>Four separate pieces had to line up correctly: the right kind of microchip, the right kind of rabies vaccine, a blood sample sent to a lab Japan actually recognizes, and a Japan-specific import form that our own country’s standard export paperwork doesn’t cover. A fifth complication sat underneath all of it — our dog has a heart condition, and a possible surgery meant the travel date itself couldn’t be treated as fixed.</p>' +

        '<h2>Advice that didn’t hold up</h2>' +
        '<p>A vet mentioned, in passing, that our documents needed blue-ink signatures. We couldn’t find that requirement written down anywhere official, and an original document isn’t something you casually redo, so we chased it down. A designated lab’s own FAQ states plainly that a black-ink signature is fine. Japan’s official import guide specifies no signature ink color at all — it rules out pencil and correction fluid, which is a different requirement entirely. The blue-ink rule exists for some countries’ export certificates; it does not apply to this one.</p>' +
        '<p>The same pattern showed up with the export certificate itself. Our home country issues a standard, generic international health certificate that covers exporting an animal to most destinations. Japan is not “most destinations”: it requires its own specific form, and our own country’s official guidance says not to use the generic certificate when the destination country supplies its own. We only caught this by reading past the first search result and cross-checking two official sources against each other — and it changed which document our vet actually needed to complete.</p>' +

        '<h2>The country nobody could agree on</h2>' +
        '<p>The most genuinely unresolved question we ran into wasn’t about Japan at all — it was about our own route there. Our dog lives in Canada, was microchipped and vaccinated in Canada, and had blood drawn in Canada that was then shipped to a laboratory in the United States, simply because that’s where an approved lab exists. Our travel plan adds a third leg: driving from Canada into the United States, an overnight stay, then a direct flight to Japan from a U.S. airport the next day — under 24 hours on U.S. soil in total.</p>' +
        '<p>That raises a specific question: for Japan’s paperwork, which country is the exporting country — Canada, where our dog lives and where every vaccination and test actually took place, or the United States, where the international flight physically departs from? We asked this in more than one place and got two different confident answers. A Canada-focused resource treated Canada as the exporting country by default and didn’t address the U.S. leg at all. A resource focused on airline and airport requirements framed the country of departure as what matters, which points to the United States instead. Neither source was wrong on its own terms — each was answering from its own slice of the process, and neither accounted for a route that touches both countries.</p>' +
        '<p>We have not found one authoritative source that resolves this directly. The practical consequence: we are arranging export certification from both countries — a Canadian-endorsed certificate through our own official channel, and a U.S.-endorsed one as well — rather than guessing which one gets checked at the airport. That’s more paperwork and more cost than either certificate alone. Given how much a wrong guess would cost us, redundancy is the correct trade.</p>' +

        '<h2>Deadlines that fail in two different ways</h2>' +
        '<p>Once the vaccination and blood test were done, the real planning started, because that test result has a shelf life, and it can expire in two different ways with two very different consequences. The result must be at least 180 days old before travel, and it stays valid for 2 years total from the draw date — but only if our dog’s rabies vaccine coverage never lapses in between. From our March 24, 2026 draw date, that gave us a window opening in late September 2026 and closing in March 2028.</p>' +
        '<p>Those two limits fail differently. If our travel date ever slipped past the 2-year mark, that’s a recoverable failure: we redraw blood, wait out a new 180-day clock, and travel later than planned. If a rabies booster were ever given even a day after the previous one’s labeled protection period ended, the entire process resets — new vaccination series, new blood test, new 180-day wait, six-plus months undone by one missed appointment. Because the two failures cost so differently, we sized two different safety buffers: about a week of margin around any future blood retest, and closer to six weeks of margin around any future booster — both marked on an actual calendar, not left to memory.</p>' +

        '<h2>Why this was never just paperwork</h2>' +
        '<p>Our dog’s heart condition meant a real chance of surgery interrupting our timeline. Understanding exactly how much flexibility the 180-day and 2-year rules actually allow — and confirming that a delayed trip costs us nothing as long as vaccine coverage stays unbroken — separated a medical decision from a paperwork deadline. That distinction mattered more to us than any individual form.</p>' +

        '<h2>Why we’re sharing this</h2>' +
        '<p>None of this was insurmountable. It took more research and more cross-checking than it should have, because well-meaning advice was sometimes accurate, sometimes outdated, and sometimes simply built for a route that crosses one country instead of three. We built this tool so the next person starts with a clearer map — including an honest account of the one question we still haven’t fully resolved. If you find a more definitive answer on the exporting-country question than we have, tell us: it’s the single biggest gap left in this checklist.</p>' +
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
        '<h1>Resources &amp; FAQ</h1>' +
        '<p class="muted">Common questions and myths, plain-language definitions, and links to official sources.</p>' +
        '<div class="section-spacer">' +
          '<h2>Frequently asked questions</h2>' + faqGroupsHtml +
        '</div>' +
        '<div class="section-spacer">' +
          '<h2>Glossary</h2>' + glossaryHtml +
        '</div>' +
        '<div class="section-spacer card">' +
          '<h2>Official sources</h2>' +
          '<p>This tool summarizes and simplifies real requirements — always cross-check against the official source before you travel.</p>' +
          '<ul>' + sourcesHtml + '</ul>' +
          '<p class="muted">Content last reviewed: ' + escapeHtml(DATA.lastVerified) + '</p>' +
        '</div>' +
      '</section>'
    ));
  }

  /* ================= WIZARD ================= */
  function getVisibleSteps(answers) {
    return DATA.wizard.filter(function (q) { return matches(q.showIf, answers); });
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
        '<div class="card">' +
          '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="progress-label"><span>Question ' + (idx + 1) + ' of ' + steps.length + '</span><span>' + pct + '%</span></div>' +
          '<span class="question-label">' + escapeHtml(q.label) + '</span>' +
          (q.help ? '<p class="question-help">' + escapeHtml(q.help) + '</p>' : '') +
          '<div id="fieldHost"></div>' +
          '<p class="field-error" style="display:none;color:#b3261e;font-weight:600;margin-top:10px;">Please answer this question to continue.</p>' +
          '<div class="wizard-nav">' +
            '<button type="button" class="btn-secondary" id="btnBack">&larr; Back</button>' +
            '<div style="display:flex;gap:10px;align-items:center;">' +
              (!q.required ? '<button type="button" class="skip-link" id="btnSkip">Skip</button>' : '') +
              '<button type="button" class="btn-primary" id="btnNext">' + (idx === steps.length - 1 ? 'See my checklist →' : 'Continue →') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      container.innerHTML = html;
      renderField(q, answers, container.querySelector('#fieldHost'));

      container.querySelector('#btnNext').addEventListener('click', function () {
        if (q.required && !isAnswered(q, answers)) {
          container.querySelector('.field-error').style.display = 'block';
          return;
        }
        saveAnswers(answers);
        if (idx < steps.length - 1) { idx++; update(); }
        else { location.hash = '#/results'; }
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
      var opts = '<option value="">Choose one…</option>' + DATA.countries.map(function (c) {
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

  /* ================= MODAL (export / import) ================= */
  function openModal(title, bodyEl) {
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
    }
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

  function downloadTextAsFile(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function buildExportPayload() {
    return {
      pawportExport: true,
      version: 1,
      exportedAt: new Date().toISOString(),
      answers: loadAnswers(),
      checked: loadChecked()
    };
  }

  function openExportModal() {
    var payload = buildExportPayload();
    var json = JSON.stringify(payload, null, 2);
    var dogBit = payload.answers.dogName ? ' for ' + payload.answers.dogName : '';
    var filename = 'pawport-checklist' + (payload.answers.dogName ? '-' + payload.answers.dogName.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '') + '.json';

    var body = el(
      '<div>' +
        '<p>Save this to move your checklist' + escapeHtml(dogBit) + ' to another device, or as a backup.</p>' +
        '<button type="button" class="btn-primary" id="btnDownloadJson">⬇️ Download as a file</button>' +
        '<div class="modal-divider">or copy the text</div>' +
        '<textarea class="json-textarea" id="exportTextarea" readonly></textarea>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-secondary" id="btnCopyJson">📋 Copy to clipboard</button>' +
        '</div>' +
        '<div class="modal-status" id="exportStatus"></div>' +
      '</div>'
    );
    body.querySelector('#exportTextarea').value = json;

    var handle = openModal('Export your checklist', body);
    body.querySelector('#btnDownloadJson').addEventListener('click', function () {
      downloadTextAsFile(filename, json);
    });
    body.querySelector('#btnCopyJson').addEventListener('click', function () {
      copyTextToClipboard(json, function (ok) {
        var status = body.querySelector('#exportStatus');
        status.textContent = ok ? 'Copied to clipboard.' : 'Could not copy automatically — select the text above and copy it manually.';
        status.className = 'modal-status ' + (ok ? 'ok' : 'err');
      });
    });
    body.querySelector('#exportTextarea').addEventListener('click', function (e) { e.target.select(); });
  }

  function applyImportedPayload(parsed) {
    var answers = (parsed && typeof parsed.answers === 'object' && parsed.answers) ? parsed.answers : null;
    if (!answers) throw new Error('This file doesn’t look like a PawPort checklist export (no “answers” found).');
    var checked = (parsed && typeof parsed.checked === 'object' && parsed.checked) ? parsed.checked : {};
    saveAnswers(answers);
    saveChecked(checked);
  }

  function openImportModal() {
    var body = el(
      '<div>' +
        '<p>Bring in a checklist you exported from another device.</p>' +
        '<label class="file-drop-label" id="fileDropLabel">📁 Choose a checklist file to upload<input type="file" accept="application/json,.json" id="importFileInput"></label>' +
        '<div class="modal-divider">or paste it</div>' +
        '<textarea class="json-textarea" id="importTextarea" placeholder="Paste your exported checklist JSON here"></textarea>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-primary" id="btnImportPasted">Import pasted text</button>' +
        '</div>' +
        '<div class="modal-status" id="importStatus"></div>' +
      '</div>'
    );

    var handle = openModal('Import a checklist', body);
    var statusEl = body.querySelector('#importStatus');

    function finishImport(rawText) {
      try {
        var parsed = JSON.parse(rawText);
        applyImportedPayload(parsed);
        statusEl.textContent = 'Checklist imported. Loading it now…';
        statusEl.className = 'modal-status ok';
        setTimeout(function () {
          handle.close();
          if (location.hash === '#/results') navigate();
          else location.hash = '#/results';
        }, 500);
      } catch (err) {
        statusEl.textContent = 'Couldn’t import that: ' + err.message;
        statusEl.className = 'modal-status err';
      }
    }

    body.querySelector('#importFileInput').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { finishImport(String(reader.result || '')); };
      reader.onerror = function () {
        statusEl.textContent = 'Couldn’t read that file.';
        statusEl.className = 'modal-status err';
      };
      reader.readAsText(file);
    });
    body.querySelector('#btnImportPasted').addEventListener('click', function () {
      var text = body.querySelector('#importTextarea').value.trim();
      if (!text) {
        statusEl.textContent = 'Paste your checklist JSON first.';
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
          '<h2>Let’s build your checklist first</h2>' +
          '<p>We don’t have any answers saved yet on this device.</p>' +
          '<div class="cta-row" style="justify-content:flex-start;">' +
            '<a href="#/wizard" class="btn-primary" data-nav>Start the questions &rarr;</a>' +
            '<button type="button" class="btn-secondary" id="btnImportEmpty">📥 Import a checklist instead</button>' +
          '</div>' +
        '</div>'
      );
      app.appendChild(emptyCard);
      emptyCard.querySelector('#btnImportEmpty').addEventListener('click', openImportModal);
      return;
    }

    var country = countriesByCode[answers.originCountry] || { name: 'your country', designated: false };
    var checked = loadChecked();
    var eff = getEffectiveAnswers(answers);
    var dates = computeAllDates(eff);
    var visibleItems = DATA.checklistItems.filter(function (item) { return matches(item.showIf, eff); });
    var alerts = computeFeasibilityAlerts(eff, dates, country, todayDateOnly());

    var doneCount = visibleItems.filter(function (item) { return checked[item.id]; }).length;
    var totalCount = visibleItems.length;
    var pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

    var dogLabel = answers.dogName ? escapeHtml(answers.dogName) + '’s' : 'Your';

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
        '<h1>' + dogLabel + ' checklist for Japan</h1>' +
        '<p class="muted">Starting from ' + escapeHtml(country.name) + (answers.dogBreed ? ' &middot; ' + escapeHtml(answers.dogBreed) : '') + '</p>' +
      '</div>'
    );
    app.appendChild(header);

    if (country.designated) {
      app.appendChild(el(
        '<div class="designated-banner">' +
          '<strong>' + escapeHtml(country.name) + ' is currently one of Japan’s designated (rabies-free) regions.</strong> That means a simplified path — no FAVN antibody test required, based on residency instead. Double-check this is still current before you rely on it (see the checklist below).' +
        '</div>'
      ));
    }

    var progressWrap = el(
      '<div class="progress-summary">' +
        '<div style="flex:1;">' +
          '<div class="progress-track"><div class="progress-fill" id="resultsProgressFill" style="width:' + pct + '%"></div></div>' +
        '</div>' +
        '<div class="progress-circle-label" id="resultsProgressLabel">' + doneCount + ' / ' + totalCount + ' done</div>' +
      '</div>'
    );
    app.appendChild(progressWrap);

    var actions = el(
      '<div class="results-actions">' +
        '<button type="button" class="btn-secondary" id="btnPrint">🖨️ Print / Save as PDF</button>' +
        '<a href="#/wizard" class="btn-secondary" data-nav>✏️ Edit my answers</a>' +
        '<button type="button" class="btn-secondary" id="btnExport">⬇️ Export checklist</button>' +
        '<button type="button" class="btn-secondary" id="btnImport">⬆️ Import checklist</button>' +
        '<button type="button" class="btn-secondary" id="btnStartOver">↺ Start over</button>' +
      '</div>'
    );
    app.appendChild(actions);
    actions.querySelector('#btnPrint').addEventListener('click', function () { window.print(); });
    actions.querySelector('#btnExport').addEventListener('click', openExportModal);
    actions.querySelector('#btnImport').addEventListener('click', openImportModal);
    actions.querySelector('#btnStartOver').addEventListener('click', function () {
      if (window.confirm('This clears all your saved answers and progress on this device. Continue?')) {
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
            body += '<br><br><strong>📍 Specific to ' + escapeHtml(country.name) + ':</strong> ' + escapeHtml(detail);
          }
        }
        var dateCalloutHtml = '';
        if (item.computedDate && dates[item.computedDate]) {
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
          document.getElementById('resultsProgressLabel').textContent = newDone + ' / ' + totalCount + ' done';
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

  /* ================= nav wiring ================= */
  function wireChrome() {
    document.getElementById('navToggle').addEventListener('click', function () {
      var nav = document.getElementById('siteNav');
      var open = nav.classList.toggle('open');
      document.getElementById('navToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    loadBuildInfo();
  }

  /* ================= build/publish stamp =================
     There's no build step for this site, so instead of a manually
     maintained (and quickly stale) timestamp, ask GitHub directly for
     the latest commit on main and derive both the published time and
     the commit hash from that — always accurate, nothing to remember
     to update. Fails silently (footer just omits the stamp) if the
     API is unreachable, e.g. offline or rate-limited. */
  function loadBuildInfo() {
    var publishedEl = document.getElementById('publishedAt');
    var hashLink = document.getElementById('buildHashLink');
    fetch('https://api.github.com/repos/njmurarka/pawport/commits/main')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.sha) return;
        var commitDate = data.commit && data.commit.committer && data.commit.committer.date;
        if (publishedEl && commitDate) {
          var d = new Date(commitDate);
          if (!isNaN(d.getTime())) {
            var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            publishedEl.textContent = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + ' (' + tz + ')';
          }
        }
        if (hashLink) {
          hashLink.textContent = data.sha.slice(0, 7);
          hashLink.href = 'https://github.com/njmurarka/pawport/commit/' + data.sha;
        }
      })
      .catch(function () { /* offline or rate-limited — leave the placeholder as-is */ });
  }

  /* ================= init ================= */
  function init() {
    fetch('data/checklist-data.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        DATA = data;
        DATA.countries.forEach(function (c) { countriesByCode[c.code] = c; });
        wireChrome();
        navigate();
        window.addEventListener('hashchange', navigate);
      })
      .catch(function (err) {
        document.getElementById('app').innerHTML =
          '<div class="card"><h2>Something went wrong loading the checklist data.</h2><p class="muted">' + escapeHtml(err && err.message) + '</p></div>';
        console.error(err);
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
