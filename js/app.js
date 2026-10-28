/*
 * 页面交互：把输入交给 core.js 算，再把结果和项目卡片画出来。
 * 不联网；你填的东西只存在这个标签页的 sessionStorage 里，关掉标签页就没了。
 */
(function () {
  'use strict';
  const QP = window.QP;
  const core = QP.core;
  const STORE_KEY = 'qp-v0';

  // 这一版只在第 1 步画出 Claude。ChatGPT 先藏起来：问卷第 5 题还留着，选了它会提示先去算。
  const SERVICES = [
    {
      id: 'claude', name: 'Claude', shown: true,
      plans: [['pro', 'Pro'], ['max5', 'Max（5 倍）'], ['max20', 'Max（20 倍）'], ['team', '团队版 / 企业版'], ['other', '其他会员档']]
    },
    {
      id: 'chatgpt', name: 'ChatGPT（Codex）', shown: false,
      plans: [['plus', 'Plus'], ['pro', 'Pro'], ['business', 'Business / 团队版'], ['enterprise', '企业版 / 教育版'], ['other', '其他会员档']]
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
      '  <h3><span class="map-mark" aria-hidden="true">①</span> <span class="mode-label" data-used="5 小时额度，已经用了百分之几" data-left="5 小时额度，还剩百分之几">5 小时额度，已经用了百分之几</span></h3>' +
      '  <fieldset class="inline">' +
      '    <legend class="visually-hidden">百分比是已经用了还是还剩</legend>' +
      '    <label><input type="radio" name="' + p + '-mode" value="used" checked> 已经用了百分之几</label>' +
      '    <label><input type="radio" name="' + p + '-mode" value="left"> 还剩百分之几</label>' +
      '    <p class="hint">① 和 ③ 的百分比都按这个填。</p>' +
      '  </fieldset>' +
      '  <label class="field"><span class="visually-hidden">① 百分比</span>' +
      '    <span class="pct"><input type="text" inputmode="decimal" id="' + p + '-s-pct" autocomplete="off" placeholder="比如 72" aria-label="① 5 小时额度已经用了百分之几" data-used-label="① 5 小时额度已经用了百分之几" data-left-label="① 5 小时额度还剩百分之几"> %</span>' +
      '  </label>' +
      '</div>' +
      '<div class="copy-slot" data-slot="2">' +
      '  <h3><span class="map-mark" aria-hidden="true">②</span> 这段还要多久重置</h3>' +
      '  <fieldset class="reset">' +
      '    <legend class="visually-hidden">② 重置时间</legend>' +
      '    <div class="choice">' +
      '      <input type="radio" name="' + p + '-s-reset" id="' + p + '-s-r-cd" value="countdown" checked>' +
      '      <label for="' + p + '-s-r-cd">还有</label>' +
      '      <span class="unit"><input type="text" inputmode="numeric" class="short" id="' + p + '-s-h" autocomplete="off" aria-label="② 还有几小时"> 小时</span>' +
      '      <span class="unit"><input type="text" inputmode="numeric" class="short" id="' + p + '-s-m" autocomplete="off" aria-label="② 还有几分钟"> 分钟</span>' +
      '    </div>' +
      '    <div class="choice">' +
      '      <input type="radio" name="' + p + '-s-reset" id="' + p + '-s-r-ck" value="clock">' +
      '      <label for="' + p + '-s-r-ck">或者在</label>' +
      '      <input type="time" id="' + p + '-s-clock" aria-label="② 几点几分重置"> 重置' +
      '    </div>' +
      '  </fieldset>' +
      '  <p class="hint">还没开始用（0%、页面上没写重置时间）可以不填。</p>' +
      '</div>' +
      '<div class="copy-slot" data-slot="3">' +
      '  <h3><span class="map-mark" aria-hidden="true">③</span> <span class="mode-label" data-used="每周额度：已经用了百分之几，" data-left="每周额度：还剩百分之几，">每周额度：已经用了百分之几，</span><br>周几几点重置</h3>' +
      '  <label class="field">百分比' +
      '    <span class="pct"><input type="text" inputmode="decimal" id="' + p + '-w-pct" autocomplete="off" placeholder="比如 31" aria-label="③ 每周额度已经用了百分之几" data-used-label="③ 每周额度已经用了百分之几" data-left-label="③ 每周额度还剩百分之几"> %</span>' +
      '  </label>' +
      '  <label class="field">周几重置 <select id="' + p + '-w-day" aria-label="③ 每周额度周几重置"><option value="">选一下</option>' + days + '</select></label>' +
      '  <label class="field">几点 <input type="time" id="' + p + '-w-clock" aria-label="③ 每周额度几点重置"> <span class="hint">不确定可以不填</span></label>' +
      '  <p class="hint">如果有好几条周额度，抄用得最多的那条。写的是日期的话，看看那天是周几。</p>' +
      '</div>';
  }

  // 把示意图上的示例数字填进同样编号的格子。不自己点「算一下」。
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
    const name = s.name + (planLabel(s, r.plan) ? '（' + planLabel(s, r.plan) + '）' : '');
    if (!r.ok) {
      return el('div', { class: 'result result-error', 'data-service': s.id }, [
        el('p', { class: 'result-title', text: name + '：' + (r.notApplicable ? '不适用' : '还有几样没填好') }),
        el('ul', null, r.errors.map(e => el('li', { text: e.msg })))
      ]);
    }
    const info = core.BAND_INFO[r.band];
    const W = core.WINDOW_NAME;
    const R = core.RULES;
    const neck = { session: '卡在 5 小时额度', weekly: '卡在每周额度', both: '两个一样多' }[r.bottleneck];
    const why = [
      '5 小时额度还剩 ' + pct(r.sessionLeft) + '，每周额度还剩 ' + pct(r.weeklyLeft) +
        '。取少的那个：有效剩余 ' + pct(r.effective) + '（' + neck + '）。',
      '离每周额度重置：' + core.formatUntil(r.weeklyHours) + '；离 5 小时额度重置：' + core.formatUntil(r.sessionHours) + '。'
    ];
    // 写清楚是哪一条规则定的档
    if (r.timeCapped && r.band === 'small') {
      why.push('按剩余本来能做' + core.BAND_INFO[r.baseBand].label + '，但离每周额度重置只剩几小时（不到 ' + R.fewHours +
        ' 小时），时间只够做小档。重置以后再回来算一次。');
    } else if (r.timeCapped) {
      why.push('两个都剩 ' + R.largeAbove + '% 以上，本来能做大档，但离每周额度重置不到 1 天。大档要 2–3 小时、常常要分几次做，所以先推中档。');
    } else if (r.band === 'large') {
      why.push('两个都剩 ' + R.largeAbove + '% 以上，离每周额度重置也还有 1 天以上，所以是大档。');
    } else if (r.band === 'medium') {
      why.push('有一个只剩 ' + R.smallBelow + '%–' + R.largeAbove + '%，所以是中档。');
    } else if (r.band === 'small') {
      why.push('有一个剩不到 ' + R.smallBelow + '%，所以是小档。');
    }
    const summary = r.band === 'none'
      ? '现在没有剩余，先别开新项目。等「' + W[r.waitFor.which] + '」重置（' + core.formatUntil(r.waitFor.hours) + '）再回来算。'
      : '能做' + info.label + '的项目：' + info.time + '。';
    return el('div', { class: 'result band-' + r.band, 'data-service': s.id, 'data-band': r.band }, [
      el('p', { class: 'result-title' }, [name + '：', el('span', { class: 'badge', text: info.label })]),
      el('p', { class: 'result-summary', text: summary }),
      el('ul', { class: 'why' }, why.map(t => el('li', { text: t }))),
      r.notes.length ? el('ul', { class: 'notes' }, r.notes.map(t => el('li', { text: t }))) : null
    ]);
  }

  function renderResults() {
    const box = $('calc-results');
    box.textContent = '';
    if (!state.computedAt) return;
    const ids = Object.keys(state.results);
    if (!ids.length) {
      box.appendChild(el('p', { class: 'msg warn', text: '先在上面选一下你订的是哪一档，再点「算一下」。' }));
      return;
    }
    if (state.stale) {
      box.appendChild(el('p', { class: 'msg warn', text: '下面是做项目之前算的，已经过时了。对照用量页把数字更新一下，再点「算一下」。' }));
    } else if (state.edited) {
      box.appendChild(el('p', { class: 'msg warn', text: '你改了数字，还没重新算。点「算一下」更新。' }));
    }
    shownServices().forEach(s => { if (state.results[s.id]) box.appendChild(resultBox(s, state.results[s.id])); });
    box.appendChild(el('p', { class: 'small', text: '按你点「算一下」那一刻（' + hhmm(state.computedAt) + '）算的。' }));
    if (ids.some(id => state.results[id].ok)) {
      box.appendChild(el('p', { class: 'next' }, [
        '下一步：', el('a', { href: '#quiz', text: '说说你想做什么' }), '，或者直接', el('a', { href: '#recs', text: '看推荐的项目' }), '。'
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
          el('span', null, [d.label, d.hint ? el('span', { class: 'chip-hint', text: '比如：' + d.hint }) : null])
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
    if (quiz.service) return { id: quiz.service, reason: 'chosen' };
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
    return el('article', { class: 'card band-' + p.band, 'data-id': p.id, 'data-band': p.band, 'data-top': top ? '1' : null }, [
      el('div', { class: 'card-top' }, [
        el('span', null, [el('span', { class: 'badge', text: info.label }), top ? el('span', { class: 'top-tag', text: '最贴合你' }) : null]),
        el('span', { class: 'domain', text: p.custom ? '按你写的事' : core.domainLabel(p.domain) })
      ]),
      el('h3', { text: p.title }),
      el('dl', null, [
        el('dt', { text: '档位' }),
        el('dd', null, [info.label + ' · ' + info.time, el('span', { class: 'why-band', text: why.band })]),
        el('dt', { text: '为什么推给你' }),
        el('dd', { class: 'why-pref' }, why.matches.length
          ? [el('ul', null, why.matches.map(t => el('li', { text: t })))]
          : [el('span', { class: 'why-none', text: why.summary })]),
        el('dt', { text: '目标产出' }), el('dd', { text: p.output }),
        el('dt', { text: '大概步骤' }), el('dd', null, [el('ol', null, p.steps.map(t => el('li', { text: t })))]),
        el('dt', { text: '验收标准（做完手里有什么）' }), el('dd', { text: p.done })
      ]),
      el('button', { type: 'button', class: 'done-btn', text: '我做完了', onclick: () => markDone(p) })
    ]);
  }

  function status(text, cls) {
    $('recs-status').appendChild(el('p', { class: 'msg ' + (cls || 'info'), text: text }));
  }

  // 上一次算的结果里，离每周额度重置还有多久（做完一个以后提醒：在那之前都可以接着做）
  function roundLine(quiz) {
    const pick = pickService(quiz);
    const r = pick && state.results[pick.id];
    if (!r || !r.ok || !state.computedAt) return '';
    const left = r.weeklyHours - (QP.now() - state.computedAt) / 3600000;
    const when = Math.round(left * 60) <= 0 ? '马上就要重置了' : '离重置还有 ' + core.formatHours(left);
    return '按上次算的，' + serviceOf(pick.id).name + ' 的每周额度' + when +
      '。在那之前，做完一个就回来算一次，接着做下一个；额度用完或者重置了，这一轮就结束。';
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
    if (state.stale) {
      $('done-title').textContent = '做完「' + state.lastDone + '」了，真不错！';
      $('done-round').textContent = roundLine(quiz);
      status('先重新算一次剩余，这里才会推下一个。', 'warn');
      return;
    }

    const pick = pickService(quiz);
    if (!pick) {
      status('先在第 1 步算一下剩余，这里才会出项目。');
      return;
    }
    const svc = serviceOf(pick.id);
    const r = state.results[pick.id];
    if (!r) {
      status('你在问题 5 选了 ' + svc.name + '，但第 1 步还没算它的剩余。先去算一下，或者把问题 5 换成你算过的服务。', 'warn');
      return;
    }
    if (!r.ok) {
      status(r.notApplicable
        ? svc.name + '：按 API 用量付钱的情况这里不适用，没法推荐。'
        : svc.name + ' 的数字还没填好，先回第 1 步补上。', 'warn');
      return;
    }
    if (r.band === 'none') {
      status(svc.name + ' 的额度现在用完了，先别开新项目。等「' + core.WINDOW_NAME[r.waitFor.which] +
        '」重置（' + core.formatUntil(r.waitFor.hours) + '）再回来算。', 'warn');
      return;
    }

    const info = core.BAND_INFO[r.band];
    // 先按档位过滤、再按偏好排序，都在 core.recommend 里
    const rec = core.recommend({
      band: r.band, done: state.done,
      domains: quiz.domains, otherDomain: quiz.other, wish: quiz.wish, outputs: quiz.outputs, audiences: quiz.audiences
    });

    let head = '按 ' + svc.name + ' 的剩余推荐：' + info.label + '（' + info.time + '）。只推这一档，不会推超过你剩余的项目。';
    if (pick.reason === 'bigger') head += '你两个服务都算了、问题 5 没选，就先按剩得多的那个推；想换就去问题 5 选。';
    if (pick.reason === 'tie') head += '你两个服务算出来一样大、问题 5 没选，就先按 ' + svc.name + ' 推；想换就去问题 5 选。';
    status(head, 'band band-' + r.band);
    if (state.edited) status('你在第 1 步改了数字，还没点「算一下」，下面还是按上一次的结果推荐的。', 'warn');

    if (!rec.personalized) {
      status('你没填第 2 步（或者跳过了），先按档位把这一档所有领域的项目都列出来。每张卡上都写着为什么推它；填了问卷会排得更合你心意。');
    } else {
      const label = (list, id) => (list.find(x => x.id === id) || { label: id }).label;
      const picked = quiz.domains.map(core.domainLabel).concat(quiz.other.trim() ? [quiz.other.trim()] : []);
      const parts = [];
      if (picked.length) parts.push('领域：' + picked.join('、'));
      if (quiz.wish.trim()) parts.push('想做的事：' + quiz.wish.trim());
      if (quiz.outputs.length) parts.push('想要的成果：' + quiz.outputs.map(id => label(QP.OUTPUTS, id)).join('、'));
      if (quiz.audiences.length) parts.push('给谁：' + quiz.audiences.map(id => label(QP.AUDIENCES, id)).join('、'));
      status('按你的回答排的——' + parts.join('；') + '。对上的越多排得越前，每张卡上写着对上了哪几点。');
    }
    if (state.doneTitles.length) {
      status('这一轮已经做完 ' + state.doneTitles.length + ' 个：' + state.doneTitles.join('、') + '。做完的不会再推。', 'ok');
    }

    const mine = rec.cards.filter(p => p.custom).length;
    if (rec.cards.length === mine) {
      // 这一档现成的项目都做完了（可能只剩按「想做的事」现做的那张）
      status('这一档现成的项目你都做完了！' + (mine
        ? '可以做下面这张按你写的事现做的，或者看看小一点的。'
        : '可以看看下面小一点的，或者在问题 2 写下你想做的事，我们帮你把它变成一个项目。'), 'ok');
    } else if (rec.fallback) {
      status('你填的偏好在这一档暂时没有对得上的现成项目，先把这一档的都列出来。', 'warn');
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

  function clearAll() {
    try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* 没存过 */ }
    $('calc-form').reset();
    $('quiz-form').reset();
    Object.assign(state, { results: {}, computedAt: null, edited: false, stale: false, done: [], doneTitles: [], lastDone: '' });
    shownServices().forEach(s => { togglePlan(s.id); syncModeLabels(s.id); });
    clearInvalid();
    $('restore-note').hidden = true;
    renderResults();
    renderRecs();
    $('clear-msg').textContent = '已经全部清掉了：问卷回答、第 1 步的数字、做完的记录。';
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
