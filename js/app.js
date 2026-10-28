/*
 * 页面交互：把输入交给 core.js 算，再把结果和项目卡片画出来。
 * 不联网；你填的东西只存在这个标签页的 sessionStorage 里，关掉标签页就没了。
 */
(function () {
  'use strict';
  const QP = window.QP;
  const core = QP.core;
  const STORE_KEY = 'qp-v0';

  // This version draws Claude only. ChatGPT stays in the catalog data with shown:false and has no quiz control.
  const SERVICES = [
    {
      id: 'claude', name: 'Claude', shown: true,
      plans: [['pro', 'Pro'], ['max5', 'Max (5×)'], ['max20', 'Max (20×)'], ['team', 'Team / Enterprise'], ['other', 'Other plan']]
    },
    {
      id: 'chatgpt', name: 'ChatGPT（Codex）', shown: false,
      plans: [['plus', 'Plus'], ['pro', 'Pro'], ['business', 'Business / Team'], ['enterprise', 'Enterprise / Education'], ['other', 'Other plan']]
    }
  ];

  // 第 1 步的报错 field → 输入框 id 后缀
  const FIELD_INPUT = {
    plan: '-plan', sessionPct: '-s-pct', sessionCountdown: '-s-h', sessionClock: '-s-clock',
    weeklyPct: '-w-pct', weeklyDay: '-w-day', weeklyClock: '-w-clock'
  };

  const state = {
    results: {}, // 服务 id → core.computeService 的结果
    computedAt: null,
    edited: false, // 算完以后又改了数字，还没重新算
    stale: false, // 做完一个项目，旧结果过时了，要重新算
    done: [], // 做完的项目 id
    doneTitles: [],
    lastDone: ''
  };

  const $ = id => document.getElementById(id);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach(c => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  const pct = x => Math.round(x * 10) / 10 + '%';
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const serviceOf = id => SERVICES.find(s => s.id === id);
  const shownServices = () => SERVICES.filter(s => s.shown);

  function planLabel(s, plan) {
    const p = s.plans.find(x => x[0] === plan);
    return p ? p[1] : '';
  }

  // ---------------- 第 1 步：①②③ 和示意图对齐 ----------------

  function copyFieldsHTML(s) {
    const p = s.id;
    const days = [1, 2, 3, 4, 5, 6, 0].map(d => '<option value="' + d + '">' + core.WEEKDAYS[d] + '</option>').join('');
    return '' +
      '<div class="copy-slot" data-slot="1">' +
      '  <h3><span class="map-mark" aria-hidden="true">①</span> <span class="mode-label" data-used="Session — % used" data-left="Session — % left">Session — % used</span></h3>' +
      '  <fieldset class="inline">' +
      '    <legend class="visually-hidden">Are the percentages used or left</legend>' +
      '    <label><input type="radio" name="' + p + '-mode" value="used" checked> % used</label>' +
      '    <label><input type="radio" name="' + p + '-mode" value="left"> % left</label>' +
      '    <p class="hint">Session and Weekly percentages both use this.</p>' +
      '  </fieldset>' +
      '  <label class="field"><span class="visually-hidden">Session percent</span>' +
      '    <span class="pct"><input type="text" inputmode="decimal" id="' + p + '-s-pct" autocomplete="off" placeholder="e.g. 72" aria-label="Session percent used" data-used-label="Session percent used" data-left-label="Session percent left"> %</span>' +
      '  </label>' +
      '</div>' +
      '<div class="copy-slot" data-slot="2">' +
      '  <h3><span class="map-mark" aria-hidden="true">②</span> Resets in</h3>' +
      '  <fieldset class="reset">' +
      '    <legend class="visually-hidden">Resets in</legend>' +
      '    <div class="choice">' +
      '      <input type="radio" name="' + p + '-s-reset" id="' + p + '-s-r-cd" value="countdown" checked>' +
      '      <label for="' + p + '-s-r-cd">In</label>' +
      '      <span class="unit"><input type="text" inputmode="numeric" class="short" id="' + p + '-s-h" autocomplete="off" aria-label="Resets in hours"> hr</span>' +
      '      <span class="unit"><input type="text" inputmode="numeric" class="short" id="' + p + '-s-m" autocomplete="off" aria-label="Resets in minutes"> min</span>' +
      '    </div>' +
      '    <div class="choice">' +
      '      <input type="radio" name="' + p + '-s-reset" id="' + p + '-s-r-ck" value="clock">' +
      '      <label for="' + p + '-s-r-ck">Or at</label>' +
      '      <input type="time" id="' + p + '-s-clock" aria-label="Resets at">' +
      '    </div>' +
      '  </fieldset>' +
      '  <p class="hint">Skip if unused or blank.</p>' +
      '</div>' +
      '<div class="copy-slot" data-slot="3">' +
      '  <h3><span class="map-mark" aria-hidden="true">③</span> <span class="mode-label" data-used="Weekly — % used" data-left="Weekly — % left">Weekly — % used</span></h3>' +
      '  <label class="field">Percent' +
      '    <span class="pct"><input type="text" inputmode="decimal" id="' + p + '-w-pct" autocomplete="off" placeholder="e.g. 31" aria-label="Weekly percent used" data-used-label="Weekly percent used" data-left-label="Weekly percent left"> %</span>' +
      '  </label>' +
      '  <label class="field">Weekday <select id="' + p + '-w-day" aria-label="Weekly reset weekday"><option value="">Choose</option>' + days + '</select></label>' +
      '  <label class="field">Time <input type="time" id="' + p + '-w-clock" aria-label="Weekly reset time"> <span class="hint">optional</span></label>' +
      '  <p class="hint">If several weekly limits are listed, copy the fullest one.</p>' +
      '</div>';
  }

  // Fill the sample numbers from the map, then calculate. One click to a first result.
  function fillExample() {
    const p = 'claude';
    const block = slot => document.querySelector('.map-block[data-slot="' + slot + '"]');
    const b1 = block('1');
    const b2 = block('2');
    const b3 = block('3');
    const plan = $(p + '-plan');
    if (!plan.value || plan.value === 'api') plan.value = 'pro';
    togglePlan(p);
    setRadio(p + '-mode', 'used');
    syncModeLabels(p);
    setRadio(p + '-s-reset', 'countdown');
    $(p + '-s-pct').value = b1.getAttribute('data-pct');
    $(p + '-s-h').value = b2.getAttribute('data-hours');
    $(p + '-s-m').value = b2.getAttribute('data-minutes');
    $(p + '-s-clock').value = '';
    $(p + '-w-pct').value = b3.getAttribute('data-pct');
    $(p + '-w-day').value = b3.getAttribute('data-day');
    $(p + '-w-clock').value = b3.getAttribute('data-clock');
    clearInvalid();
    $('calc-form').dispatchEvent(new Event('input', { bubbles: true }));
    calculate();
  }

  function togglePlan(p) {
    const plan = $(p + '-plan').value;
    $(p + '-body').hidden = plan === 'api';
    $(p + '-api').hidden = plan !== 'api';
  }

  // 已用/还剩是①和③共用的。算的时候两个窗口用同一种；标题和读屏名字跟着选中的那个变。
  function syncModeLabels(p) {
    const left = radioValue(p + '-mode') === 'left';
    document.querySelectorAll('.mode-label').forEach(n => {
      const next = n.getAttribute(left ? 'data-left' : 'data-used');
      if (next) n.textContent = next;
    });
    [p + '-s-pct', p + '-w-pct'].forEach(id => {
      const n = $(id);
      if (!n) return;
      const next = n.getAttribute(left ? 'data-left-label' : 'data-used-label');
      if (next) n.setAttribute('aria-label', next);
    });
  }

  function radioValue(name) {
    const r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : '';
  }

  // value 对不上任何选项时（比如存的数据坏了）不动，免得一个都没选上
  function setRadio(name, value) {
    const radios = Array.from(document.querySelectorAll('input[name="' + name + '"]'));
    if (value && !radios.some(r => r.value === value)) return;
    radios.forEach(r => { r.checked = r.value === value; });
  }

  function readService(p) {
    const v = suffix => $(p + suffix).value;
    return {
      plan: v('-plan'), mode: radioValue(p + '-mode'),
      sessionPct: v('-s-pct'), sessionResetType: radioValue(p + '-s-reset'),
      sessionH: v('-s-h'), sessionM: v('-s-m'), sessionClock: v('-s-clock'),
      weeklyPct: v('-w-pct'), weeklyDay: v('-w-day'), weeklyClock: v('-w-clock')
    };
  }

  function writeService(p, d) {
    const set = (suffix, value) => { if (typeof value === 'string') $(p + suffix).value = value; };
    set('-plan', d.plan);
    if ($(p + '-plan').selectedIndex < 0) $(p + '-plan').value = '';
    set('-s-pct', d.sessionPct); set('-s-h', d.sessionH); set('-s-m', d.sessionM); set('-s-clock', d.sessionClock);
    set('-w-pct', d.weeklyPct); set('-w-day', d.weeklyDay); set('-w-clock', d.weeklyClock);
    if (d.mode) setRadio(p + '-mode', d.mode);
    if (d.sessionResetType) setRadio(p + '-s-reset', d.sessionResetType);
    syncModeLabels(p);
    togglePlan(p);
  }

  function clearInvalid() {
    document.querySelectorAll('#calc-form [aria-invalid]').forEach(n => n.removeAttribute('aria-invalid'));
  }

  // ---------------- 第 1 步：算 ----------------

  function calculate() {
    const now = QP.now();
    state.results = {};
    clearInvalid();
    shownServices().forEach(s => {
      const input = readService(s.id);
      if (!input.plan) return;
      const r = core.computeService(input, now);
      r.plan = input.plan;
      state.results[s.id] = r;
      if (!r.ok) {
        r.errors.forEach(e => {
          const node = $(s.id + (FIELD_INPUT[e.field] || ''));
          if (node) node.setAttribute('aria-invalid', 'true');
        });
      }
    });
    state.computedAt = now;
    state.edited = false;
    state.stale = false;
    $('restore-note').hidden = true;
    save();
    renderResults();
    renderRecs();
  }

  function resultBox(s, r) {
    const name = s.name + (planLabel(s, r.plan) ? ' (' + planLabel(s, r.plan) + ')' : '');
    if (!r.ok) {
      return el('div', { class: 'result result-error', 'data-service': s.id }, [
        el('p', { class: 'result-title', text: r.notApplicable ? 'Doesn’t apply' : 'Missing Session / Resets in / Weekly' }),
        el('p', { class: 'small', text: name }),
        el('ul', null, r.errors.map(e => el('li', { text: e.msg })))
      ]);
    }
    const info = core.BAND_INFO[r.band];
    const W = core.WINDOW_NAME;
    const R = core.RULES;
    const neck = { session: 'Limited by Session', weekly: 'Limited by Weekly', both: 'Both the same' }[r.bottleneck];
    const why = [
      'Session left ' + pct(r.sessionLeft) + ', Weekly left ' + pct(r.weeklyLeft) +
        '. The smaller one: effective left ' + pct(r.effective) + ' (' + neck + ').',
      'Until Weekly resets: ' + core.formatUntil(r.weeklyHours) + '. Until Session resets: ' + core.formatUntil(r.sessionHours) + '.'
    ];
    if (r.timeCapped && r.band === 'small') {
      why.push('By what’s left this could be ' + core.BAND_INFO[r.baseBand].label +
        ', but only a few hours remain until the weekly reset (under ' + R.fewHours +
        ' hours), so this is Small. Calculate again after the reset.');
    } else if (r.timeCapped) {
      why.push('Both are over ' + R.largeAbove + '%, which could be Large, but the weekly reset is under 1 day. Large takes 2–3 hours, often across more than one sitting, so this is Medium.');
    } else if (r.band === 'large') {
      why.push('Both are over ' + R.largeAbove + '%, and the weekly reset is more than 1 day away, so this is Large.');
    } else if (r.band === 'medium') {
      why.push('One window is only ' + R.smallBelow + '%–' + R.largeAbove + '% left, so this is Medium.');
    } else if (r.band === 'small') {
      why.push('One window is under ' + R.smallBelow + '% left, so this is Small.');
    }
    const summary = r.band === 'none'
      ? 'Nothing left. Wait for ' + W[r.waitFor.which] + ' to reset (' + core.formatUntil(r.waitFor.hours) + '), then calculate again.'
      : info.label + ' projects: ' + info.time + '.';
    return el('div', { class: 'result band-' + r.band, 'data-service': s.id, 'data-band': r.band }, [
      el('p', { class: 'result-title' }, [name + ': ', el('span', { class: 'badge', text: info.label })]),
      el('p', { class: 'result-summary', text: summary }),
      el('ul', { class: 'why' }, why.map(t => el('li', { text: t }))),
      r.notes.length ? el('ul', { class: 'notes' }, r.notes.map(t => el('li', { text: t }))) : null
    ]);
  }

  function renderResults() {
    const box = $('calc-results');
    box.textContent = '';
    if (!state.computedAt) {
      box.appendChild(el('p', { class: 'empty-title', text: 'Nothing calculated yet.' }));
      box.appendChild(el('p', { class: 'empty-hint', text: 'Paste Session / Resets in / Weekly from Usage, or try the sample.' }));
      return;
    }
    const ids = Object.keys(state.results);
    if (!ids.length) {
      box.appendChild(el('p', { class: 'msg warn', text: 'Choose a plan, then Calculate.' }));
      return;
    }
    if (state.stale) {
      box.appendChild(el('p', { class: 'msg warn', text: 'These numbers are out of date. Update them from Usage, then Calculate.' }));
    } else if (state.edited) {
      box.appendChild(el('p', { class: 'msg warn', text: 'You changed the numbers. Click Calculate to update.' }));
    }
    shownServices().forEach(s => { if (state.results[s.id]) box.appendChild(resultBox(s, state.results[s.id])); });
    box.appendChild(el('p', { class: 'small', text: 'Calculated when you clicked Calculate (' + hhmm(state.computedAt) + ').' }));
    if (ids.some(id => state.results[id].ok)) {
      box.appendChild(el('p', { class: 'next' }, [
        'Next: ', el('a', { href: '#quiz', text: 'Preferences' }), ', or ', el('a', { href: '#recs', text: 'Pick a project' }), '.'
      ]));
    }
  }

  // ---------------- 第 2 步：问卷 ----------------

  // 多选题：领域、成果、给谁。都是同一种勾选小方块。
  const CHOICES = [
    { box: 'q-domains', name: 'q-domain', key: 'domains', list: () => QP.DOMAINS },
    { box: 'q-outputs', name: 'q-output', key: 'outputs', list: () => QP.OUTPUTS },
    { box: 'q-audiences', name: 'q-audience', key: 'audiences', list: () => QP.AUDIENCES }
  ];

  function buildChoiceChips() {
    CHOICES.forEach(c => {
      c.list().forEach(d => {
        $(c.box).appendChild(el('label', { class: 'chip' + (d.hint ? ' chip-2line' : '') }, [
          el('input', { type: 'checkbox', name: c.name, value: d.id }),
          el('span', null, [d.label, d.hint ? el('span', { class: 'chip-hint', text: 'e.g. ' + d.hint }) : null])
        ]));
      });
    });
  }

  const checkedValues = name => Array.from(document.querySelectorAll('input[name="' + name + '"]:checked')).map(i => i.value);

  function readQuiz() {
    const q = { other: $('q-other').value, wish: $('q-wish').value, service: radioValue('q-service') };
    CHOICES.forEach(c => { q[c.key] = checkedValues(c.name); });
    return q;
  }

  function writeQuiz(q) {
    CHOICES.forEach(c => {
      const ids = Array.isArray(q[c.key]) ? q[c.key] : [];
      document.querySelectorAll('input[name="' + c.name + '"]').forEach(i => { i.checked = ids.indexOf(i.value) !== -1; });
    });
    if (typeof q.other === 'string') $('q-other').value = q.other;
    if (typeof q.wish === 'string') $('q-wish').value = q.wish;
    setRadio('q-service', q.service || '');
  }

  // 用哪个服务的剩余来推荐：问卷第 5 题选了就用它；没选就用算过的那个；两个都算了就用剩得多的。
  // 只挑一个，不相加。
  function pickService(quiz) {
    if (quiz.service) {
      const chosen = serviceOf(quiz.service);
      if (chosen && chosen.shown) return { id: quiz.service, reason: 'chosen' };
    }
    const ok = SERVICES.filter(s => state.results[s.id] && state.results[s.id].ok);
    if (!ok.length) {
      const any = SERVICES.find(s => state.results[s.id]);
      return any ? { id: any.id, reason: 'only' } : null;
    }
    if (ok.length === 1) return { id: ok[0].id, reason: 'only' };
    const bandOf = s => core.rank(state.results[s.id].band);
    if (bandOf(ok[0]) === bandOf(ok[1])) return { id: ok[0].id, reason: 'tie' };
    const best = ok.slice().sort((a, b) => bandOf(b) - bandOf(a))[0];
    return { id: best.id, reason: 'bigger' };
  }

  // ---------------- 第 3 步：推荐卡片 ----------------

  // 一张项目卡：为什么推它（档位 + 对上了哪些偏好）、目标产出、大概步骤、验收标准
  function card(p, top) {
    const info = core.BAND_INFO[p.band];
    const why = p.why || { band: '', matches: [], summary: '' };
    const pref = why.matches.length ? why.matches.join(' ') : why.summary;
    const bullets = [];
    if (why.band) bullets.push(el('li', { class: 'why-band', text: why.band }));
    if (pref) bullets.push(el('li', { class: 'why-pref', text: pref }));
    return el('article', { class: 'card band-' + p.band, 'data-id': p.id, 'data-band': p.band, 'data-top': top ? '1' : null }, [
      el('div', { class: 'card-top' }, [
        el('span', null, [
          el('span', { class: 'badge', text: info.label }),
          top ? el('span', { class: 'top-tag', text: 'Best match' }) : null
        ]),
        el('span', { class: 'time', text: info.time })
      ]),
      el('h3', { text: p.title }),
      el('p', { class: 'domain', text: p.custom ? 'From what you wrote' : core.domainLabel(p.domain) }),
      el('p', { class: 'k', text: 'Why' }),
      el('ul', { class: 'why' }, bullets.slice(0, 2)),
      el('p', { class: 'done-when' }, [el('span', { class: 'k', text: 'Done when:' }), ' ' + (p.done || '')]),
      el('details', { class: 'steps' }, [
        el('summary', { text: 'Show steps' }),
        el('ol', null, (p.steps || []).map(t => el('li', { text: t })))
      ]),
      el('button', { type: 'button', class: 'done-btn', text: 'Mark done', onclick: () => markDone(p) })
    ]);
  }

  function status(text, cls) {
    $('recs-status').appendChild(el('p', { class: 'msg ' + (cls || 'info'), text: text }));
  }

  function renderRecs() {
    const list = $('recs-list');
    const smallerBox = $('recs-smaller');
    const othersBox = $('recs-others');
    $('recs-status').textContent = '';
    list.textContent = '';
    $('smaller-list').textContent = '';
    $('others-list').textContent = '';
    smallerBox.hidden = true;
    othersBox.hidden = true;
    $('done-banner').hidden = !state.stale;

    const quiz = readQuiz();
    if (state.stale) return;

    const pick = pickService(quiz);
    if (!pick) {
      status('Calculate in step 1 to see projects.');
      return;
    }
    const svc = serviceOf(pick.id);
    const r = state.results[pick.id];
    if (!r) {
      status('Step 1 has not calculated ' + svc.name + ' yet.', 'warn');
      return;
    }
    if (!r.ok) {
      status(r.notApplicable
        ? 'API billing has no session/weekly window — this tool doesn’t apply.'
        : 'Finish Session, Resets in, and Weekly in step 1.', 'warn');
      return;
    }
    if (r.band === 'none') {
      status(svc.name + ' has nothing left. Wait for ' + core.WINDOW_NAME[r.waitFor.which] +
        ' to reset (' + core.formatUntil(r.waitFor.hours) + '), then calculate again.', 'warn');
      return;
    }

    const info = core.BAND_INFO[r.band];
    // 先按档位过滤、再按偏好排序，都在 core.recommend 里
    const rec = core.recommend({
      band: r.band, done: state.done,
      domains: quiz.domains, otherDomain: quiz.other, wish: quiz.wish, outputs: quiz.outputs, audiences: quiz.audiences
    });

    let head = 'From what’s left on ' + svc.name + ': ' + info.label + ' (' + info.time + '). Only this band.';
    if (pick.reason === 'bigger') head += ' Two results were tied to different bands; this is the larger one.';
    if (pick.reason === 'tie') head += ' Two results matched; this one is ' + svc.name + '.';
    status(head, 'band band-' + r.band);
    if (state.edited) status("You changed the numbers and haven't clicked Calculate. Projects below still use the last result.", 'warn');

    if (!rec.personalized) {
      status('No preferences yet (or you skipped), so this lists every project in the band.');
    } else {
      const label = (list, id) => (list.find(x => x.id === id) || { label: id }).label;
      const picked = quiz.domains.map(core.domainLabel).concat(quiz.other.trim() ? [quiz.other.trim()] : []);
      const parts = [];
      if (picked.length) parts.push('Area: ' + picked.join(', '));
      if (quiz.wish.trim()) parts.push('Want to do: ' + quiz.wish.trim());
      if (quiz.outputs.length) parts.push('Outcome: ' + quiz.outputs.map(id => label(QP.OUTPUTS, id)).join(', '));
      if (quiz.audiences.length) parts.push('For: ' + quiz.audiences.map(id => label(QP.AUDIENCES, id)).join(', '));
      status('Sorted by your answers — ' + parts.join('; ') + '.');
    }
    if (state.doneTitles.length) {
      status('Finished ' + state.doneTitles.length + ' this round: ' + state.doneTitles.join(', ') + '. Finished ones stay hidden.', 'ok');
    }

    const mine = rec.cards.filter(p => p.custom).length;
    if (rec.cards.length === mine) {
      status('You’ve finished every ready-made project in this band. ' + (mine
        ? 'You can do the card built from what you wrote, or look at a smaller one.'
        : 'Look at a smaller one below, or write what you want in question 2.'), 'ok');
    } else if (rec.fallback) {
      status('Nothing in this band matches what you picked, so here is the whole band.', 'warn');
    }
    const top = rec.personalized && !rec.fallback;
    rec.cards.forEach((p, i) => list.appendChild(card(p, top && i === 0)));

    if (rec.others.length) {
      othersBox.hidden = false;
      $('others-count').textContent = String(rec.others.length);
      rec.others.forEach(p => $('others-list').appendChild(card(p)));
    }
    if (rec.smaller.length) {
      smallerBox.hidden = false;
      $('smaller-count').textContent = String(rec.smaller.length);
      rec.smaller.forEach(p => $('smaller-list').appendChild(card(p)));
    }
  }

  // 做完一个：记下来，提示用户回用量页重新算，再推下一个（v0 手动，不自动追踪）
  function markDone(p) {
    if (state.done.indexOf(p.id) === -1) {
      state.done.push(p.id);
      state.doneTitles.push(p.title);
    }
    state.lastDone = p.title;
    state.stale = true;
    save();
    renderResults();
    renderRecs();
    $('recs').scrollIntoView({ block: 'start' });
    $('recalc-btn').focus({ preventScroll: true });
  }

  // 跳过问卷：不动已经填的，直接去第 3 步
  function skipQuiz() {
    $('recs').scrollIntoView({ block: 'start' });
    $('recs-title').focus({ preventScroll: true });
  }

  function goRecalc() {
    $('calc').scrollIntoView({ block: 'start' });
    const first = shownServices().map(s => $(s.id + '-s-pct')).find(n => n && n.offsetParent !== null);
    (first || $('claude-plan')).focus({ preventScroll: true });
  }

  // ---------------- 只存在本标签页 ----------------

  function save() {
    const data = {
      v: 1, inputs: {}, quiz: readQuiz(),
      done: state.done, doneTitles: state.doneTitles, lastDone: state.lastDone, stale: state.stale
    };
    shownServices().forEach(s => { data.inputs[s.id] = readService(s.id); });
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* 存不了也不影响使用 */ }
  }

  function restore() {
    let data = null;
    try { data = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null'); } catch (e) { data = null; }
    if (!data || data.v !== 1) return;
    shownServices().forEach(s => writeService(s.id, (data.inputs || {})[s.id] || {}));
    writeQuiz(data.quiz || {});
    state.done = Array.isArray(data.done) ? data.done.filter(x => typeof x === 'string') : [];
    state.doneTitles = Array.isArray(data.doneTitles) ? data.doneTitles.filter(x => typeof x === 'string') : [];
    state.lastDone = typeof data.lastDone === 'string' ? data.lastDone : '';
    state.stale = !!data.stale && !!state.lastDone;
    if (shownServices().some(s => $(s.id + '-plan').value)) $('restore-note').hidden = false;
  }

  // Fill from Claude Usage. Copy is the UX lock; one click only writes step 1 fields.
  const FILL_WORKING = 'Reading Usage…';
  const FILL_OK = 'Filled from Usage.';
  const FILL_NO_EXT = 'Extension not found. Copy the three numbers, or load the unpacked extension (see README).';
  const FILL_PARSE = 'Couldn\'t read Usage. Keep Claude → Settings → Usage open, then try again — or copy by hand.';
  const FILL_TIMEOUT_MS = 1500;
  let fillGen = 0;
  let fillTimer = 0;
  let applyingFill = false;

  function showFillStatus(kind, text) {
    if (fillTimer) { clearTimeout(fillTimer); fillTimer = 0; }
    const node = $('fill-status');
    if (!node) return;
    if (!text) {
      node.textContent = '';
      node.hidden = true;
      node.className = 'fill-status';
      return;
    }
    node.hidden = false;
    node.className = 'fill-status ' + kind;
    node.textContent = text;
    if (kind === 'ok') {
      fillTimer = setTimeout(() => {
        fillTimer = 0;
        showFillStatus('', '');
      }, 2000);
    }
  }

  function requestUsageFill() {
    return new Promise(resolve => {
      const id = 'byt-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      let done = false;
      function finish(value) {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(value);
      }
      function onMsg(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'byt-extension' || data.type !== 'fill-result' || data.id !== id) return;
        finish(data);
      }
      const timer = setTimeout(() => finish({ ok: false, error: 'no-extension' }), FILL_TIMEOUT_MS);
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'byt-page', type: 'fill-request', id: id }, '*');
    });
  }

  function assignField(id, value) {
    if (value == null || value === '') return;
    $(id).value = String(value);
  }

  // Writes only Session, Resets in, and Weekly (plus weekday/time when the read included them).
  function writeUsage(p, u) {
    if (!u) return;
    if (u.mode === 'used' || u.mode === 'left') {
      setRadio(p + '-mode', u.mode);
      syncModeLabels(p);
    }
    assignField(p + '-s-pct', u.sessionPct);
    if (u.sessionResetType === 'clock') {
      setRadio(p + '-s-reset', 'clock');
      $(p + '-s-clock').value = u.sessionClock ? String(u.sessionClock) : '';
      $(p + '-s-h').value = '';
      $(p + '-s-m').value = '';
    } else if (u.sessionResetType === 'countdown') {
      setRadio(p + '-s-reset', 'countdown');
      $(p + '-s-h').value = u.sessionH == null ? '' : String(u.sessionH);
      $(p + '-s-m').value = u.sessionM == null ? '' : String(u.sessionM);
      $(p + '-s-clock').value = '';
    } else if (u.sessionResetType === 'none') {
      setRadio(p + '-s-reset', 'countdown');
      $(p + '-s-h').value = '';
      $(p + '-s-m').value = '';
      $(p + '-s-clock').value = '';
    }
    assignField(p + '-w-pct', u.weeklyPct);
    if (u.weeklyDay != null && u.weeklyDay !== '') $(p + '-w-day').value = String(u.weeklyDay);
    if (u.weeklyClock) $(p + '-w-clock').value = String(u.weeklyClock);
  }

  async function fillFromUsage() {
    const gen = ++fillGen;
    showFillStatus('working', FILL_WORKING);
    let result = null;
    try {
      result = await requestUsageFill();
    } catch (e) {
      result = { ok: false, error: 'parse' };
    }
    if (gen !== fillGen) return;
    if (!result || result.ok !== true || !result.usage || result.usage.sessionPct == null || result.usage.weeklyPct == null) {
      showFillStatus('warn', result && result.error === 'no-extension' ? FILL_NO_EXT : FILL_PARSE);
      return;
    }
    applyingFill = true;
    try {
      writeUsage('claude', result.usage);
      clearInvalid();
      $('calc-form').dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
      applyingFill = false;
      if (gen === fillGen) showFillStatus('warn', FILL_PARSE);
      return;
    }
    applyingFill = false;
    if (gen !== fillGen) return;
    showFillStatus('ok', FILL_OK);
  }

  function clearAll() {
    fillGen += 1;
    showFillStatus('', '');
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* 没存过 */ }
    $('calc-form').reset();
    $('quiz-form').reset();
    Object.assign(state, { results: {}, computedAt: null, edited: false, stale: false, done: [], doneTitles: [], lastDone: '' });
    shownServices().forEach(s => { togglePlan(s.id); syncModeLabels(s.id); });
    clearInvalid();
    $('restore-note').hidden = true;
    renderResults();
    renderRecs();
    $('clear-msg').textContent = 'Cleared quiz answers, step 1 numbers, and finished projects.';
    $('clear-msg').hidden = false;
  }

  // ---------------- 启动 ----------------

  function init() {
    $('services').innerHTML = copyFieldsHTML(serviceOf('claude'));
    buildChoiceChips();

    shownServices().forEach(s => {
      const p = s.id;
      $(p + '-plan').addEventListener('change', () => togglePlan(p));
      // 点进哪种重置时间的输入框，就自动选上那一种
      [p + '-s-h', p + '-s-m'].forEach(id => $(id).addEventListener('focus', () => setRadio(p + '-s-reset', 'countdown')));
      $(p + '-s-clock').addEventListener('focus', () => setRadio(p + '-s-reset', 'clock'));
      document.querySelectorAll('input[name="' + p + '-mode"]').forEach(input => {
        input.addEventListener('change', () => syncModeLabels(p));
      });
    });

    const calcForm = $('calc-form');
    calcForm.addEventListener('submit', e => { e.preventDefault(); calculate(); });
    const onCalcEdit = () => {
      $('clear-msg').hidden = true;
      if (!applyingFill) {
        fillGen += 1;
        showFillStatus('', '');
      }
      if (state.computedAt && !state.edited) { state.edited = true; renderResults(); renderRecs(); }
      save();
    };
    calcForm.addEventListener('input', onCalcEdit);
    calcForm.addEventListener('change', onCalcEdit);

    const quizForm = $('quiz-form');
    quizForm.addEventListener('submit', e => e.preventDefault());
    const onQuizEdit = () => { $('clear-msg').hidden = true; save(); renderRecs(); };
    quizForm.addEventListener('input', onQuizEdit);
    quizForm.addEventListener('change', onQuizEdit);

    $('clear-btn').addEventListener('click', clearAll);
    $('fill-usage-btn').addEventListener('click', fillFromUsage);
    $('example-btn').addEventListener('click', fillExample);
    $('skip-btn').addEventListener('click', skipQuiz);
    $('recalc-btn').addEventListener('click', goRecalc);

    restore();
    renderResults();
    renderRecs();
  }

  init();
  QP.app = { SERVICES: SERVICES, state: state, calculate: calculate, renderRecs: renderRecs, clearAll: clearAll };
})();
