/*
 * 页面流程测试：把 index.html 放进 iframe，像用户一样填表、点按钮，再检查页面上显示的东西。
 * 地址后面加 ?shot=375（或别的宽度）：测完后把页面留在「填满」的状态，方便截图看窄屏效果。
 */
(function () {
  'use strict';
  const frame = document.getElementById('app');
  let W = null; // iframe 的 window
  let D = null; // iframe 的 document
  const appErrors = [];

  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function flushFill() {
    await wait(0);
    await wait(0);
    await wait(0);
  }
  const $ = id => D.getElementById(id);
  const text = node => (node ? node.textContent : '');

  // Makes matchMedia('(prefers-reduced-motion: …)') in the app iframe answer from reduce(), read on
  // every call; other queries go to the real matchMedia. Returns a function that restores it.
  function mockReducedMotion(reduce) {
    const win = W;
    const real = win.matchMedia;
    win.matchMedia = function (query) {
      const q = String(query);
      if (q.indexOf('prefers-reduced-motion') === -1) return real.call(win, query);
      const on = !!reduce();
      return {
        matches: q.indexOf('no-preference') !== -1 ? !on : on,
        media: q,
        onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return false; }
      };
    };
    return () => { win.matchMedia = real; };
  }

  // Fill, Get project, Mark done and Fill again scroll their target into view. Headless runs use
  // virtual time, which does not drive smooth-scroll animation, so scroll-position checks make
  // scrolling instant: the app is told the user prefers reduced motion (so it asks for
  // behavior 'auto'), and the iframe's html is pinned to scroll-behavior: auto, because 'auto'
  // follows that property and css/style.css smooths it for no-preference, the real setting here.
  // instantScroll(false) restores both.
  let undoInstant = null;
  function instantScroll(on) {
    D.documentElement.style.scrollBehavior = on ? 'auto' : '';
    if (on && !undoInstant) undoInstant = mockReducedMotion(() => true);
    if (!on && undoInstant) {
      undoInstant();
      undoInstant = null;
    }
  }

  // Logs scrollIntoView and focus calls in the app iframe, in call order. Scrolls are recorded,
  // not run: these checks are about the options the app passes, and a real smooth scroll would
  // stall half done under virtual time (tests/motion.html checks real scroll positions).
  // Focus still runs, so activeElement checks keep working.
  function spyScrollFocus() {
    const scrollProto = W.Element.prototype;
    const focusProto = W.HTMLElement.prototype;
    const realScroll = scrollProto.scrollIntoView;
    const realFocus = focusProto.focus;
    const log = [];
    scrollProto.scrollIntoView = function (opts) {
      log.push({ kind: 'scroll', node: this, opts: opts, block: opts && opts.block, behavior: opts && opts.behavior });
    };
    focusProto.focus = function (opts) {
      log.push({ kind: 'focus', node: this, opts: opts, preventScroll: !!(opts && opts.preventScroll) });
      return realFocus.call(this, opts);
    };
    return {
      log: log,
      since: n => log.slice(n),
      restore: () => {
        scrollProto.scrollIntoView = realScroll;
        focusProto.focus = realFocus;
      }
    };
  }

  const nodeName = n => (!n ? 'null' : n.id ? '#' + n.id : n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).trim().split(/\s+/).join('.') : ''));

  // entries: spy log for one action. steps: [scrollNode, block, focusNode] in the order the
  // action runs them. Every scroll passes { block, behavior: want }; every focus passes
  // preventScroll: true and comes after the scroll that brought its target into view;
  // a focused heading has tabindex="-1".
  function expectScrollThenFocus(entries, want, steps, what) {
    const shown = entries.map(e => e.kind + ' ' + nodeName(e.node) +
      (e.kind === 'scroll' ? '/' + e.block + '/' + e.behavior : e.preventScroll ? '/preventScroll' : '/scrolls')).join(', ') || 'none';
    const scrolls = entries.filter(e => e.kind === 'scroll');
    ok(scrolls.length > 0, what + ': no scrollIntoView call');
    scrolls.forEach((e, i) => {
      ok(e.opts && typeof e.opts === 'object', what + ': scroll ' + (i + 1) + ' passes an options object (' + shown + ')');
      eq(e.behavior, want, what + ': behavior of scroll ' + (i + 1) + ' to ' + nodeName(e.node));
    });
    entries.filter(e => e.kind === 'focus').forEach(e => {
      ok(e.preventScroll, what + ': focus on ' + nodeName(e.node) + ' passes preventScroll (' + shown + ')');
      if (/^H[1-6]$/.test(e.node.tagName)) eq(e.node.getAttribute('tabindex'), '-1', what + ': focused heading ' + nodeName(e.node) + ' tabindex');
    });
    steps.forEach(s => {
      const at = entries.findIndex(e => e.kind === 'scroll' && e.node === s[0] && e.block === s[1]);
      ok(at !== -1, what + ': scrolls ' + nodeName(s[0]) + ' to ' + s[1] + ' (' + shown + ')');
      const first = entries.findIndex(e => e.kind === 'focus' && e.node === s[2]);
      ok(first !== -1, what + ': focuses ' + nodeName(s[2]) + ' (' + shown + ')');
      ok(first > at, what + ': focuses ' + nodeName(s[2]) + ' after scrolling ' + nodeName(s[0]) + ', not before (' + shown + ')');
    });
  }

  // block: 'nearest' lines the control up with the bottom edge, so allow 1px of subpixel rounding.
  function inViewport(node) {
    const r = node.getBoundingClientRect();
    return r.top >= -1 && r.bottom <= W.innerHeight + 1;
  }
  function isShown(node) {
    if (!node || !node.isConnected) return false;
    for (let n = node; n && n !== D.body; n = n.parentElement) {
      if (n.hidden) return false;
      if (n.tagName === 'DETAILS' && !n.open && n !== node) return false;
      const cs = W.getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }

  const shownButtons = () => Array.from(D.querySelectorAll('button')).filter(isShown);

  function loadApp(clearStorage) {
    return new Promise((resolve, reject) => {
      frame.onload = () => {
        try {
          W = frame.contentWindow;
          D = W.document;
        } catch (e) {
          reject(new Error('读不到 iframe（要用 http 服务器打开，不能用 file://）'));
          return;
        }
        W.addEventListener('error', e => appErrors.push(e.message));
        // 固定「现在」：2026-07-13 周一 10:00（避开夏令时切换）
        W.QP.now = () => new Date(2026, 6, 13, 10, 0, 0);
        if (clearStorage) {
          W.sessionStorage.clear();
          frame.onload = () => { W = frame.contentWindow; D = W.document; W.QP.now = () => new Date(2026, 6, 13, 10, 0, 0); W.addEventListener('error', e => appErrors.push(e.message)); resolve(); };
          W.location.reload();
          return;
        }
        resolve();
      };
      frame.src = '../index.html';
    });
  }

  function reloadApp() {
    return new Promise(resolve => {
      frame.onload = () => {
        W = frame.contentWindow;
        D = W.document;
        W.QP.now = () => new Date(2026, 6, 13, 10, 0, 0);
        W.addEventListener('error', e => appErrors.push(e.message));
        resolve();
      };
      W.location.reload();
    });
  }

  function setVal(id, v) {
    const n = $(id);
    if (!n) throw new Error('找不到输入框 ' + id);
    n.value = v;
    n.dispatchEvent(new W.Event('input', { bubbles: true }));
    n.dispatchEvent(new W.Event('change', { bubbles: true }));
  }

  function pick(selector) {
    const n = D.querySelector(selector);
    if (!n) throw new Error('找不到 ' + selector);
    if (!n.checked) n.click();
  }

  function unpick(selector) {
    const n = D.querySelector(selector);
    if (n && n.checked) n.click();
  }

  // o: { plan, mode, s, h, m, clock, w, day, wclock }
  function fill(p, o) {
    setVal(p + '-plan', o.plan || 'pro');
    if (o.mode) pick('input[name="' + p + '-mode"][value="' + o.mode + '"]');
    setVal(p + '-s-pct', o.s == null ? '' : String(o.s));
    if (o.clock != null) {
      pick('input[name="' + p + '-s-reset"][value="clock"]');
      setVal(p + '-s-clock', o.clock);
    } else {
      pick('input[name="' + p + '-s-reset"][value="countdown"]');
      setVal(p + '-s-h', o.h == null ? '3' : String(o.h));
      setVal(p + '-s-m', o.m == null ? '0' : String(o.m));
    }
    setVal(p + '-w-pct', o.w == null ? '' : String(o.w));
    setVal(p + '-w-day', o.day == null ? '4' : String(o.day));
    setVal(p + '-w-clock', o.wclock == null ? '08:00' : o.wclock);
  }

  function calc() { $('calc-btn').click(); }

  const FILL_WORKING = 'Reading Usage…';
  const FILL_OK = 'Filled from Usage.';
  const FILL_AGAIN = 'Updated from Usage.';
  const FILL_NO_EXT = 'No extension? No problem. Type your numbers below, or install it in 30 seconds.';
  const FILL_PARSE = 'Couldn’t read Usage. Keep Claude → Settings → Usage open, then try again — or copy by hand.';

  function removeUsageBridge() {
    if (W.__bytBridge) {
      W.removeEventListener('message', W.__bytBridge);
      W.__bytBridge = null;
    }
  }

  function deliverUsage(id, result) {
    if (!result) return;
    // Call through the page so postMessage's source is the app window, same as the extension.
    W.QP.app.postToPage({
      source: 'byt-extension',
      type: 'fill-result',
      id: id,
      ok: result.ok === true,
      error: result.error || '',
      usage: result.usage || null
    });
  }

  function installUsageBridge(respond) {
    removeUsageBridge();
    function onMsg(event) {
      if (event.source !== W) return;
      const data = event.data;
      if (!data || data.source !== 'byt-page' || data.type !== 'fill-request') return;
      const result = respond(data);
      if (result && typeof result.then === 'function') {
        result.then(value => deliverUsage(data.id, value));
        return;
      }
      deliverUsage(data.id, result);
    }
    W.__bytBridge = onMsg;
    W.addEventListener('message', onMsg);
  }

  function fixtureUsage() {
    const doc = document.getElementById('usage-fixture').contentDocument;
    ok(doc && doc.body && doc.body.textContent.indexOf('72%') !== -1, 'usage fixture loaded');
    const usage = parseUsageRoot(doc, new Date(2026, 6, 13, 10, 0, 0));
    ok(usage && usage.ok, 'fixture parses');
    return usage;
  }
  function resultOf(p) {
    const chips = $('band-chips');
    if (chips && !chips.hidden && chips.dataset.service === p && chips.dataset.band) return chips;
    return D.querySelector('#calc-results [data-service="' + p + '"]');
  }
  const cards = () => Array.from(D.querySelectorAll('#recs-list .card'));
  const moreCards = () => Array.from(D.querySelectorAll('#more-list .card'));
  const whyOf = card => text(card.querySelector('.why-line'));
  const bandCount = band => W.QP.PROJECTS.filter(p => p.band === band).length;
  const statusText = () => text($('recs-status'));

  async function fresh() {
    W.QP.app.clearAll();
    $('clear-msg').hidden = true;
    await wait(0);
  }

  // ---------------- 测试 ----------------

  test('页面正常加载：英文、只有 Claude、7 个领域、还没算时的空状态、没有 ChatGPT', async () => {
    await loadApp(true);
    ok(W.QP && W.QP.app, 'app.js 跑完了');
    ok($('svc-claude') && !$('svc-chatgpt'), '只有 Claude，没有 ChatGPT 卡');
    eq(D.querySelectorAll('input[name="q-domain"]').length, 7, '领域选项');
    eq(D.querySelector('main').dataset.phase, 'first', 'first visit');
    ok(!isShown($('recs')), 'recommendations hidden on first visit');
    ok(!isShown($('usage-fields')), 'plan and grid hidden on first visit');
    eq(text($('calc-results')).trim(), '', 'no result copy on first visit');
    eq(D.getElementById('clear-btn').textContent.trim(), 'Clear my answers', '清除按钮');
    eq(D.querySelectorAll('input[name="q-service"]').length, 0, '没有服务题');
    ok(!D.querySelector('input[value="chatgpt"]'), '没有 ChatGPT');
    eq(D.querySelectorAll('#calc-results .result, #calc-results .card').length, 0, 'no result card');
    const how = D.querySelector('details.how-copy');
    ok(how && !how.open, 'How to copy starts closed');
    ok(!isShown(how), 'How to copy is in overflow');
    eq(how.querySelector('summary').textContent.trim(), 'How to copy');
    ok(how.querySelector('.copy-path') && how.querySelector('.num-key') && how.querySelector('.usage-map'), 'copy path, key, and map are one fold');
    const prefs = D.querySelector('#quiz details.prefs');
    ok(prefs && !prefs.open, 'preferences start closed');
    ok(!isShown(prefs), 'preferences are off the main path');
    eq(prefs.querySelector('summary').textContent.trim(), 'Preferences (optional)');
    const wkLabels = Array.from(D.querySelectorAll('[data-slot="3"] .field.wk .field-label')).map(n => n.textContent.trim());
    eq(wkLabels.join('|'), 'Percent|Weekday|Time (optional)', 'weekly labels share one pattern; optional is in the Time label');
    ok(!D.querySelector('[data-slot="3"] .field .hint'), 'no separate optional line under Time');
    ok($('overflow') && !$('overflow').open, 'overflow starts closed');
    eq(text(D.querySelector('.lead')).trim(), 'Fill from Usage, get one project, Mark done.');
    ok(!D.querySelector('.jump') && !D.querySelector('.loop-line'), 'no jump nav or loop line');
    eq(text(D.querySelector('h1')).trim(), 'Leftover Claude quota?');
    const honesty = 'Runs only in this tab. Only reads Usage after you click Fill. Nothing burns until you Mark done.';
    eq(text(D.querySelector('footer')).replace(/\s+/g, ' ').trim(), honesty, 'footer');
    eq(D.body.textContent.split('Nothing burns until you Mark done.').length - 1, 1, 'honesty once');
    ok(D.body.textContent.indexOf('Doesn\u2019t read Claude Usage') === -1, 'old honesty gone');
    eq($('fill-usage-btn').textContent.trim(), 'Fill from Claude Usage');
    eq($('calc-btn').textContent.trim(), 'Get project');
    ok(!isShown($('calc-btn')), 'Get project hidden until Fill');
    ok(!isShown($('example-btn')), 'Try sample stays in overflow');
    eq(shownButtons().map(b => b.id).join(), 'fill-usage-btn', 'sole primary button');
    ok($('fill-usage-btn').classList.contains('primary'), 'Fill is primary');
    ok($('calc-btn').classList.contains('secondary') && $('example-btn').classList.contains('secondary'), 'Get project and Try sample stay secondary');
    eq($('fill-status').hidden, true, 'idle has no helper');
    eq($('fill-status').textContent, '', 'idle copy empty');
    eq($('claude-s-pct').value, '', 'does not fill on load');
    ok(!/[\u4e00-\u9fff]/.test(D.body.textContent), '页面没有中文');
    ok(!/\$\d/.test(D.body.textContent), 'no savings numbers on first visit');
  });

  test('从 Claude 用量页抄三个数：三行路径、①②③ 对照、Try sample 填好并算出推荐', async () => {
    await fresh();
    ok(text($('calc-title')).replace(/\s+/g, '').indexOf('Copynumbers') !== -1, text($('calc-title')));
    const path = Array.from(D.querySelectorAll('.copy-path li')).map(li => li.textContent.trim());
    eq(path.join('|'), 'Claude|Settings|Usage', '三行路径');
    const key = text(D.querySelector('.num-key'));
    ok(key.indexOf('Session') !== -1 && key.indexOf('Resets in') !== -1 && key.indexOf('Weekly') !== -1, key);
    eq(D.querySelectorAll('.map-block').length, 3, '示意图三块');
    eq(D.querySelectorAll('.copy-slot').length, 3, '输入三块');
    ok(text(D.querySelector('.map-block[data-slot="1"]')).indexOf('72%') !== -1, '① 示例');
    ok(text(D.querySelector('.map-block[data-slot="2"]')).indexOf('3 hr 12 min') !== -1, '② 示例');
    const block3 = text(D.querySelector('.map-block[data-slot="3"]'));
    ok(block3.indexOf('31%') !== -1 && block3.indexOf('Thu') !== -1, '③ 示例');

    eq(cards().length, 0, '还没算');
    eq($('example-btn').textContent.trim(), 'Try sample');
    $('example-btn').click();
    eq($('claude-plan').value, 'pro', '没选档时示例用 Pro');
    eq($('claude-s-pct').value, D.querySelector('.map-block[data-slot="1"]').getAttribute('data-pct'), '① 填进百分比');
    eq($('claude-s-h').value, D.querySelector('.map-block[data-slot="2"]').getAttribute('data-hours'), '② 小时');
    eq($('claude-s-m').value, D.querySelector('.map-block[data-slot="2"]').getAttribute('data-minutes'), '② 分钟');
    eq($('claude-w-pct').value, D.querySelector('.map-block[data-slot="3"]').getAttribute('data-pct'), '③ 百分比');
    eq($('claude-w-day').value, D.querySelector('.map-block[data-slot="3"]').getAttribute('data-day'), '③ 周几');
    eq($('claude-w-clock').value, D.querySelector('.map-block[data-slot="3"]').getAttribute('data-clock'), '③ 几点');
    ok(D.querySelector('input[name="claude-mode"][value="used"]').checked, '按已经用了填');
    eq(cards().length, 0, 'Try sample fills only; no card yet');
    eq(text($('band-chips')).trim(), '', 'no band chips before Get project');
    eq(D.activeElement && D.activeElement.id, 'calc-btn', 'Try sample focuses Get project');
    ok(isShown($('calc-btn')), 'Get project shown after Try sample');
    ok($('calc-btn').classList.contains('primary'), 'Get project primary after Try sample');
    calc();
    eq(resultOf('claude').dataset.band, 'medium', 'Get project after sample → medium');
    ok(text($('band-chips')).indexOf('Medium') !== -1 && text($('band-chips')).indexOf('About an hour') !== -1, 'band chips');
    eq(cards().length, 1, 'one hero after Get project');
    eq(D.querySelectorAll('#calc-results .result, #calc-results .card').length, 0, 'results are chips, not a card');

    setVal('claude-plan', 'max20');
    $('example-btn').click();
    eq($('claude-plan').value, 'max20', '已经选了档就不改');
    eq(cards().length, 0, 'Try sample clears prior card; does not re-run Get project');
    eq(D.activeElement && D.activeElement.id, 'calc-btn', 'Try sample after edit focuses Get project');
    setVal('claude-plan', 'api');
    ok($('claude-body').hidden, 'API 先把格子收起来');
    $('example-btn').click();
    eq($('claude-plan').value, 'pro', 'API 用示例时改回 Pro');
    ok(!$('claude-body').hidden, '格子又打开');
    eq($('claude-s-pct').value, '72', '① 还是示例');
    eq(D.activeElement && D.activeElement.id, 'calc-btn', 'Try sample again focuses Get project');

    $('overflow').open = true;
    D.querySelector('details.how-copy').open = true;
    await wait(50);
    async function aligned(width) {
      frame.style.width = width + 'px';
      await wait(80);
      ['1', '2', '3'].forEach(slot => {
        const a = D.querySelector('.map-block[data-slot="' + slot + '"]').getBoundingClientRect();
        const b = D.querySelector('.copy-slot[data-slot="' + slot + '"]').getBoundingClientRect();
        ok(Math.abs(a.left - b.left) <= 1, width + ' 左对齐 ' + slot + '：' + a.left + ' / ' + b.left);
        ok(Math.abs(a.width - b.width) <= 1, width + ' 同宽 ' + slot + '：' + a.width + ' / ' + b.width);
      });
      ok(D.documentElement.scrollWidth <= W.innerWidth + 1, width + ' 没有横向滚动');
    }
    await aligned(375);
    await aligned(900);
    frame.style.width = '';
  });

  test('Resets in stays one row (In [h] hr [m] min) on mobile, tablet (720), and desktop; slots 1 and 3 unchanged', async () => {
    await fresh();
    $('example-btn').click();
    await wait(50);
    async function oneRow(width) {
      frame.style.width = width + 'px';
      await wait(80);
      const row = D.querySelector('.copy-slot[data-slot="2"] .reset .choice');
      const parts = [row.querySelector('input[type="radio"]'), $('claude-s-h'), $('claude-s-m')];
      const mids = parts.map(n => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; });
      ok(mids.every(m => Math.abs(m - mids[0]) <= 4), width + ' Resets in is one row: ' + mids.map(Math.round).join('/'));
      ok(parts[0].getBoundingClientRect().left < parts[1].getBoundingClientRect().left &&
         parts[1].getBoundingClientRect().left < parts[2].getBoundingClientRect().left, width + ' order: radio, hours, minutes');
      ok(D.documentElement.scrollWidth <= W.innerWidth + 1, width + ' no horizontal scroll');
    }
    await oneRow(390);
    await oneRow(720);
    await oneRow(1280);
    frame.style.width = '';
  });

  test('Get project scrolls to the hero and focuses its title', async () => {
    await fresh();
    fill('claude', { s: 72, h: 3, m: 12, w: 31 });
    // Same trick as Fill-scroll checks: virtual time does not finish CSS smooth scrolling.
    // Reduced motion is tests/motion.html, which reads real scroll positions.
    instantScroll(true);
    try {
      calc();
      const hero = cards()[0];
      ok(hero && hero.classList.contains('hero'), 'hero rendered');
      const title = hero.querySelector('h3');
      ok(title && title.getAttribute('tabindex') === '-1', 'title is focusable');
      eq(D.activeElement, title, 'focus on the hero title, not the card');
      ok(title.getBoundingClientRect().top >= -1 && title.getBoundingClientRect().top < W.innerHeight, 'title scrolled into view');
    } finally {
      instantScroll(false);
    }
  });

  test('css/style.css: smooth scrolling is opt-in; the only scroll-behavior: smooth sits in @media (prefers-reduced-motion: no-preference)', () => {
    const sheet = Array.from(D.styleSheets).find(s => s.href && /\/css\/style\.css$/.test(s.href.split('?')[0]));
    ok(sheet, 'css/style.css is loaded in the app');
    // Every scroll-behavior declaration, with the rules around it (@media, @supports, nesting).
    // Style rules have a cssRules list too (CSS nesting), so read each rule's own style first.
    const decls = [];
    (function walk(rules, groups) {
      Array.from(rules).forEach(rule => {
        const value = rule.style ? rule.style.getPropertyValue('scroll-behavior').trim() : '';
        if (value) decls.push({ groups: groups, selector: rule.selectorText, value: value });
        if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, groups.concat(rule));
      });
    })(sheet.cssRules, []);
    const where = d => d.groups.map(g => (g instanceof W.CSSMediaRule ? '@media ' + g.media.mediaText : g.cssText.split('{')[0].trim())).join(' > ') || 'top level';
    const shown = decls.map(d => where(d) + ' ' + d.selector + ' { scroll-behavior: ' + d.value + ' }').join('; ') || 'none';
    const smooth = decls.filter(d => d.value === 'smooth');
    eq(smooth.length, 1, 'one scroll-behavior: smooth (' + shown + ')');
    ok(smooth[0].groups.length === 1 && smooth[0].groups[0] instanceof W.CSSMediaRule, 'smooth sits in one @media rule (' + shown + ')');
    eq(smooth[0].groups[0].media.mediaText, '(prefers-reduced-motion: no-preference)', 'media text');
    eq(smooth[0].selector, 'html', 'smooth applies to html');
    ok(!decls.some(d => !d.groups.length), 'no scroll-behavior at top level (' + shown + ')');
    eq(decls.length, 1, 'no other scroll-behavior rule, so no reduce override either (' + shown + ')');
    const base = Array.from(sheet.cssRules).filter(r => r instanceof W.CSSStyleRule && r.selectorText === 'html');
    eq(base.length, 1, 'one top-level html rule');
    eq(base[0].style.getPropertyValue('text-size-adjust') || base[0].style.getPropertyValue('-webkit-text-size-adjust'), '100%', 'base html rule keeps -webkit-text-size-adjust');
    // This headless run has no reduced-motion preference, so the media rule applies.
    instantScroll(false);
    eq(W.matchMedia('(prefers-reduced-motion: no-preference)').matches, true, 'real preference here is no-preference');
    eq(W.getComputedStyle(D.documentElement).scrollBehavior, 'smooth', 'html computes to smooth for no-preference');
  });

  test('Reduced motion: Get project, Mark done and Fill again scroll with behavior auto, otherwise smooth; focus follows each scroll (matchMedia mocked)', async () => {
    const usage = fixtureUsage();
    for (const reduce of [false, true]) {
      const want = reduce ? 'auto' : 'smooth';
      const tag = (reduce ? 'reduce' : 'no-preference') + ' ';
      await fresh();
      const undo = mockReducedMotion(() => reduce);
      const spy = spyScrollFocus();
      installUsageBridge(() => ({ ok: true, usage: usage }));
      try {
        fill('claude', { s: 72, h: 3, m: 12, w: 31 });
        let from = spy.log.length;
        calc();
        const hero = cards()[0];
        ok(hero && hero.classList.contains('hero'), tag + 'hero rendered');
        expectScrollThenFocus(spy.since(from), want, [[hero, 'start', hero.querySelector('h3')]], tag + 'Get project');
        eq(D.activeElement, hero.querySelector('h3'), tag + 'Get project: focus on the hero title');

        from = spy.log.length;
        hero.querySelector('.done-btn').click();
        expectScrollThenFocus(spy.since(from), want, [[$('recs'), 'start', $('recalc-btn')]], tag + 'Mark done');
        eq(D.activeElement, $('recalc-btn'), tag + 'Mark done: focus on Fill again');

        from = spy.log.length;
        $('recalc-btn').click();
        eq(D.activeElement, $('fill-usage-btn'), tag + 'Fill again: focus on Fill while it reads');
        await flushFill();
        await wait(50);
        expectScrollThenFocus(spy.since(from), want,
          [[$('calc'), 'start', $('fill-usage-btn')], [$('calc-btn'), 'center', $('calc-btn')]], tag + 'Fill again');
        eq(D.activeElement, $('calc-btn'), tag + 'Fill again: after the reply, focus on Get project');
      } finally {
        spy.restore();
        undo();
        removeUsageBridge();
      }
    }
  });

  test('Reduced motion switched on and off mid-session (no reload): each next scroll follows the setting at that moment', async () => {
    const usage = fixtureUsage();
    await fresh();
    const doc = D;
    W.__sameSession = true;
    let reduce = false;
    const undo = mockReducedMotion(() => reduce);
    const spy = spyScrollFocus();
    installUsageBridge(() => ({ ok: true, usage: usage }));
    // Flip the setting, click, then check every scroll and focus since the flip.
    async function step(on, what, click, steps) {
      reduce = on;
      const from = spy.log.length;
      await click();
      expectScrollThenFocus(spy.since(from), on ? 'auto' : 'smooth', steps(), (on ? 'reduce' : 'no-preference') + ' ' + what);
    }
    const getProject = () => calc();
    const markDone = () => cards()[0].querySelector('.done-btn').click();
    const fillAgain = async () => {
      $('recalc-btn').click();
      await flushFill();
      await wait(50);
    };
    const heroSteps = () => [[cards()[0], 'start', cards()[0].querySelector('h3')]];
    const doneSteps = () => [[$('recs'), 'start', $('recalc-btn')]];
    const againSteps = () => [[$('calc'), 'start', $('fill-usage-btn')], [$('calc-btn'), 'center', $('calc-btn')]];
    try {
      fill('claude', { s: 72, h: 3, m: 12, w: 31 });
      await step(false, 'Get project', getProject, heroSteps);
      await step(true, 'Mark done', markDone, doneSteps);
      await step(false, 'Fill again', fillAgain, againSteps);
      await step(true, 'Get project', getProject, heroSteps);
      await step(false, 'Mark done', markDone, doneSteps);
      await step(true, 'Fill again', fillAgain, againSteps);
      await step(false, 'Get project', getProject, heroSteps);
      ok(W.__sameSession === true && W.document === doc, 'same page the whole time: no reload');
      eq(W.QP.app.state.done.length, 2, 'two projects marked done in this session');
    } finally {
      spy.restore();
      undo();
      removeUsageBridge();
      delete W.__sameSession;
    }
  });

  test('Reduced motion: Fill without the extension, Fill with no plan, Try sample and Skip use the same scroll behavior (matchMedia mocked)', async () => {
    const usage = fixtureUsage();
    for (const reduce of [false, true]) {
      const want = reduce ? 'auto' : 'smooth';
      const tag = (reduce ? 'reduce' : 'no-preference') + ' ';
      await fresh();
      const undo = mockReducedMotion(() => reduce);
      const spy = spyScrollFocus();
      try {
        removeUsageBridge();
        let from = spy.log.length;
        $('fill-usage-btn').click();
        await wait(1700);
        expectScrollThenFocus(spy.since(from), want, [[$('claude-s-pct'), 'center', $('claude-s-pct')]], tag + 'Fill, no extension');
        eq(D.activeElement, $('claude-s-pct'), tag + 'no extension: focus on Session %');

        await fresh();
        installUsageBridge(() => ({ ok: true, usage: Object.assign({}, usage, { plan: '' }) }));
        from = spy.log.length;
        $('fill-usage-btn').click();
        await flushFill();
        await wait(50);
        expectScrollThenFocus(spy.since(from), want, [[$('claude-plan'), 'center', $('claude-plan')]], tag + 'Fill, no plan');
        eq(D.activeElement, $('claude-plan'), tag + 'no plan: focus on the plan select');
        removeUsageBridge();

        from = spy.log.length;
        $('example-btn').click();
        expectScrollThenFocus(spy.since(from), want, [[$('calc-btn'), 'center', $('calc-btn')]], tag + 'Try sample');
        eq(D.activeElement, $('calc-btn'), tag + 'Try sample: focus on Get project');

        calc();
        from = spy.log.length;
        $('skip-btn').click();
        expectScrollThenFocus(spy.since(from), want, [[$('recs'), 'start', $('recs-title')]], tag + 'Skip to recommendations');
        eq(D.activeElement, $('recs-title'), tag + 'Skip: focus on the recommendations heading');
      } finally {
        spy.restore();
        undo();
        removeUsageBridge();
      }
    }
  });

  test('Try sample fills fields and focuses Get project without running it', async () => {
    await fresh();
    $('example-btn').click();
    eq(cards().length, 0, 'no hero after Try sample alone');
    eq(D.activeElement && D.activeElement.id, 'calc-btn', 'focus on Get project');
    ok($('calc-btn').classList.contains('primary'), 'Get project is primary');
    if ($('calc-form').requestSubmit) $('calc-form').requestSubmit($('calc-btn'));
    else calc();
    await wait(0);
    eq(cards().length, 1, 'Get project after Try sample yields one hero');
    eq(D.activeElement, cards()[0].querySelector('h3'), 'after Get project, focus moves to the title');
  });

  test('Fill from Claude Usage fills Session, Resets in, and Weekly; Calculate is a separate click', async () => {
    await fresh();
    await reloadApp();
    removeUsageBridge();
    eq($('claude-s-pct').value, '', 'reload does not fill');
    eq($('claude-w-pct').value, '', 'weekly still empty');
    eq($('fill-status').textContent, '', 'no status on load');
    ok($('fill-status').hidden, 'status hidden on load');
    eq(text($('calc-results')).trim(), '', 'no calculate on load');
    eq(D.querySelector('main').dataset.phase, 'first', 'still first visit');
    eq($('done-banner').hidden, true, 'no mark done on load');
    eq(W.QP.app.state.done.length, 0, 'nothing marked done');
    ok(!D.querySelector('dialog'), 'status is not a modal');
    ok($('fill-status').closest('.calc-actions'), 'status sits with the buttons');

    $('fill-usage-btn').click();
    eq($('fill-status').textContent, FILL_WORKING, 'working');
    await wait(1700);
    eq($('fill-status').textContent, FILL_NO_EXT, 'no extension');
    const links = Array.from($('fill-status').querySelectorAll('a'));
    ok(!links.some(a => a.getAttribute('href') === '#usage-fields'), 'no redundant link to the already-focused fields');
    const readme = links.find(a => a.getAttribute('href') === 'README.md#load-unpacked-30-seconds');
    ok(readme && readme.textContent === 'install it in 30 seconds', 'links to README install');
    ok($('fill-status').classList.contains('info'), 'no extension reads as a hint, not an error');
    eq($('claude-s-pct').value, '', 'still empty');
    eq(text($('calc-results')).trim(), '', 'no extension does not calculate');
    eq(D.querySelector('main').dataset.phase, 'first', 'failed Fill stays on the first screen');
    ok(isShown($('usage-fields')), 'no extension opens the manual fields');
    ok(isShown($('claude-s-pct')), 'Session % is visible without opening More');
    ok(isShown($('calc-btn')), 'Get project is reachable by hand');
    eq(D.activeElement, $('claude-s-pct'), 'focus lands on Session %');
    ok(!$('overflow').open, 'More stays closed');

    const usage = fixtureUsage();
    let release = null;
    installUsageBridge(() => new Promise(resolve => { release = resolve; }));
    setVal('claude-plan', 'max5');
    pick('input[name="claude-mode"][value="left"]');
    $('fill-usage-btn').click();
    eq($('fill-status').textContent, FILL_WORKING, 'working again');
    eq($('claude-s-pct').value, '', 'does not fill before the read returns');
    await wait(0);
    ok(typeof release === 'function', 'bridge is waiting');
    eq($('fill-status').textContent, FILL_WORKING, 'still reading');
    release({ ok: true, usage: usage });
    await flushFill();
    eq($('claude-plan').value, 'max5', 'plan stays');
    eq($('claude-s-pct').value, usage.sessionPct, 'session');
    eq($('claude-s-h').value, usage.sessionH, 'hours');
    eq($('claude-s-m').value, usage.sessionM, 'minutes');
    ok(D.querySelector('input[name="claude-s-reset"][value="countdown"]').checked, 'resets in');
    eq($('claude-w-pct').value, usage.weeklyPct, 'weekly');
    eq($('claude-w-day').value, usage.weeklyDay, 'weekday');
    eq($('claude-w-clock').value, usage.weeklyClock, 'weekly time');
    ok(D.querySelector('input[name="claude-mode"][value="used"]').checked, 'percent used');
    eq($('fill-status').textContent, FILL_OK, 'success');
    eq(text($('calc-results')).trim(), '', 'fill does not calculate');
    eq(W.QP.app.state.computedAt, null, 'Fill does not Get project');
    eq(D.querySelector('main').dataset.phase, 'filled', 'fields after Fill');
    ok(isShown($('usage-fields')), 'plan and grid revealed');
    ok(isShown($('calc-btn')) && $('calc-btn').textContent.trim() === 'Get project', 'sole secondary CTA');
    ok($('calc-btn').classList.contains('primary') && !$('calc-btn').classList.contains('secondary'), 'Get project is primary after Fill');
    eq(D.activeElement && D.activeElement.id, 'calc-btn', 'Get project has focus after Fill');
    eq(shownButtons().filter(b => b.classList.contains('primary')).map(b => b.id).join(), 'calc-btn', 'only one primary after Fill');
    ok($('fill-usage-btn').classList.contains('secondary') && !$('fill-usage-btn').classList.contains('primary'), 'Fill steps down to secondary');
    eq(shownButtons().filter(b => b.classList.contains('secondary')).map(b => b.id).join(), 'fill-usage-btn', 'no other secondary CTA');
    ok(!isShown($('example-btn')), 'Try sample still in overflow');
    eq($('band-chips').hidden, true, 'no chips before Get project');
    ok(!isShown($('recs')), 'no hero before Get project');
    eq($('done-banner').hidden, true, 'fill does not mark done');
    eq(W.QP.app.state.done.length, 0, 'done list empty');
    eq(cards().length, 0, 'no project cards yet');

    calc();
    eq(resultOf('claude').dataset.band, 'medium', 'filled numbers calculate');
    eq(D.querySelector('main').dataset.phase, 'project', 'after Get project');
    eq(cards().length, 1, 'exactly one hero');
    ok(cards()[0].classList.contains('hero'), 'hero card');
    eq(cards()[0].querySelectorAll('h3').length, 1, 'title');
    ok(whyOf(cards()[0]).length > 0, 'one-line why');
    eq(cards()[0].querySelector('.done-btn').textContent.trim(), 'Mark done');
    ok(isShown($('band-chips')), 'band chips above the hero');
    const chipBoxes = Array.from($('band-chips').querySelectorAll('.band-chip')).map(n => n.getBoundingClientRect());
    eq(chipBoxes.length, 2, 'two chips');
    ok(Math.abs(chipBoxes[0].top - chipBoxes[1].top) < 4, 'chips sit on one line');
    eq(D.querySelectorAll('#recs-list .card').length, 1, 'main list is one card');
    eq(Array.from(D.querySelectorAll('.card')).filter(isShown).length, 1, 'no second visible card');
    eq(D.querySelectorAll('#calc-results .result, #calc-results .card').length, 0, 'result area is not a card');
    ok(chipBoxes[0].bottom <= cards()[0].getBoundingClientRect().top + 1, 'chips sit above the hero');
    const heroStyle = W.getComputedStyle(cards()[0]);
    ok(heroStyle.boxShadow && heroStyle.boxShadow !== 'none', 'hero shadow');
    ok(parseFloat(heroStyle.borderTopWidth) >= 4, 'top accent bar');
    ok(cards()[0].getBoundingClientRect().width >= D.querySelector('main').getBoundingClientRect().width - 48, 'full-width hero');
    ok(moreCards().length > 0 && !isShown($('recs-more')), 'more projects stay collapsed in overflow');
    ok(!/\$\d/.test(D.body.textContent), 'no savings numbers');
    eq($('fill-status').textContent, FILL_OK, 'calculate does not clear success');

    setVal('claude-s-pct', '70');
    eq($('fill-status').hidden, true, 'next edit clears success');
    eq($('fill-status').textContent, '', 'helper gone');
    ok(text($('calc-results')).indexOf('Click Get project to update') !== -1, 'edit does not recalculate');
    eq(resultOf('claude').dataset.band, 'medium', 'old band stays until Calculate');

    installUsageBridge(() => ({ ok: true, usage: usage }));
    $('fill-usage-btn').click();
    await flushFill();
    eq($('claude-s-pct').value, '72', 'filled again');
    eq($('fill-status').textContent, FILL_AGAIN, 'second read says Updated');
    ok(text($('calc-results')).indexOf('Click Get project to update') !== -1, 'second fill does not calculate');
    eq(resultOf('claude').dataset.band, 'medium', 'band unchanged');
    await wait(2200);
    eq($('fill-status').hidden, true, 'success clears after about 2s');
    eq($('fill-status').textContent, '', 'cleared');

    installUsageBridge(() => ({ ok: false, error: 'parse' }));
    $('fill-usage-btn').click();
    await flushFill();
    eq($('fill-status').textContent, FILL_PARSE, 'parse fail');
    eq($('claude-s-pct').value, '72', 'parse fail keeps the numbers');
    eq(W.QP.app.state.done.length, 0, 'parse fail does not mark done');
    eq($('done-banner').hidden, true, 'banner still hidden');

    installUsageBridge(() => ({
      ok: true,
      usage: {
        mode: 'used', sessionPct: '10', sessionResetType: 'clock', sessionClock: '10:30',
        sessionH: '', sessionM: '', weeklyPct: '10', weeklyDay: '4', weeklyClock: '08:00'
      }
    }));
    $('fill-usage-btn').click();
    await flushFill();
    eq($('claude-s-clock').value, '10:30', 'session clock');
    ok(D.querySelector('input[name="claude-s-reset"][value="clock"]').checked, 'clock mode');
    eq($('claude-s-h').value, '', 'countdown hours cleared');
    eq($('fill-status').textContent, FILL_AGAIN, 'clock fill success (later read)');
    eq(resultOf('claude').dataset.band, 'medium', 'still the previous calculation');
    calc();
    eq(resultOf('claude').dataset.band, 'large', 'clock fill calculates');
    eq(W.QP.app.state.done.length, 0, 'calculate does not mark done');

    setVal('claude-w-day', '4');
    setVal('claude-w-clock', '08:00');
    eq($('claude-w-day').value, '4', 'prior weekday');
    eq($('claude-w-clock').value, '08:00', 'prior weekly time');
    installUsageBridge(() => ({
      ok: true,
      usage: {
        mode: 'used', sessionPct: '40', sessionResetType: 'countdown', sessionH: '2', sessionM: '0',
        weeklyPct: '55', weeklyDay: '', weeklyClock: ''
      }
    }));
    $('fill-usage-btn').click();
    await flushFill();
    eq($('claude-s-pct').value, '40', 'session percent replaced');
    eq($('claude-w-pct').value, '55', 'weekly percent replaced');
    eq($('claude-w-day').value, '', 'empty parsed weekday clears the old one');
    eq($('claude-w-clock').value, '', 'empty parsed weekly time clears the old one');
    eq(resultOf('claude').dataset.band, 'large', 'fill still does not calculate');
    eq($('done-banner').hidden, true, 'fill still does not mark done');
    eq(W.QP.app.state.done.length, 0, 'done list still empty');
    removeUsageBridge();
    W.QP.app.clearAll();
    ok($('fill-usage-btn').classList.contains('primary') && !$('fill-usage-btn').classList.contains('secondary'), 'Fill primary again after clearAll');
    ok($('calc-btn').classList.contains('secondary') && !$('calc-btn').classList.contains('primary'), 'Get project secondary after clearAll');
  });

  test('Fill sets the plan when Usage shows it; otherwise the plan select is next. One primary at every step', async () => {
    const primaries = () => shownButtons().filter(b => b.classList.contains('primary')).map(b => b.id).join();
    const usage = fixtureUsage();
    eq(usage.plan, 'pro', 'fixture shows Pro');

    try {
      // Path A: plan read from Usage
      await fresh();
      eq(primaries(), 'fill-usage-btn', 'first screen: Fill is the one primary');
      installUsageBridge(() => ({ ok: true, usage: usage }));
      instantScroll(true);
      W.scrollTo(0, 0);
      $('fill-usage-btn').click();
      await flushFill();
      eq($('claude-plan').value, 'pro', 'plan set from Usage');
      eq(primaries(), 'calc-btn', 'plan read: Get project is the one primary');
      eq(D.activeElement && D.activeElement.id, 'calc-btn', 'focus on Get project');
      ok(inViewport($('calc-btn')), 'plan read: Get project scrolled into view');
      calc();
      eq(cards().length, 1, 'one card');
      eq(primaries(), 'calc-btn', 'after Get project: still one primary');
      cards()[0].querySelector('.done-btn').click();
      eq(primaries(), 'recalc-btn', 'after Mark done: Fill again is the one primary');
      eq(text($('done-line')).trim(), 'Marked done. Fill again after your next session.', 'done line text');
      eq($('done-line').childNodes.length, 1, 'done line is one text node');
      ok(!/\u2019\s|\s\u2019/.test(text($('done-line'))), 'no whitespace around the apostrophe');
      const probe = D.createElement('span');
      probe.textContent = '\u2019';
      $('done-line').appendChild(probe);
      const emRatio = probe.getBoundingClientRect().width / parseFloat(W.getComputedStyle(probe).fontSize);
      probe.remove();
      ok(emRatio < 0.5, 'apostrophe is not a full-width CJK glyph (' + emRatio.toFixed(2) + 'em)');
      ok(!$('stale-warn') || !isShown($('stale-warn')), 'no stale warning while Fill again banner shows');
      ok(!$('done-banner').hidden, 'banner visible');
      ok($('calc-btn').classList.contains('secondary'), 'Get project back to secondary after Mark done');
      $('recalc-btn').click();
      await flushFill();
      eq(primaries(), 'calc-btn', 'Fill again succeeded with a plan: Get project is primary again');
      eq(D.activeElement && D.activeElement.id, 'calc-btn', 'Fill again: focus on Get project');
      ok(inViewport($('calc-btn')), 'Fill again: Get project in view');
      eq($('fill-status').textContent, FILL_AGAIN, 'Fill again says Updated from Usage.');

      // Path B: plan not on the page
      await fresh();
      const noPlan = Object.assign({}, usage, { plan: '' });
      installUsageBridge(() => ({ ok: true, usage: noPlan }));
      instantScroll(true);
      W.scrollTo(0, 0);
      $('fill-usage-btn').click();
      await flushFill();
      eq($('claude-plan').value, '', 'plan left blank, no guess');
      eq(D.activeElement && D.activeElement.id, 'claude-plan', 'focus on the plan select');
      ok(inViewport($('claude-plan')), 'no plan: plan select scrolled into view');
      eq($('fill-status').textContent, FILL_OK, 'first read after reset says Filled');
      ok($('calc-btn').classList.contains('secondary'), 'Get project stays secondary without a plan');
      eq(primaries(), '', 'no plan yet: zero primaries, focus on the plan select');
      ok($('fill-usage-btn').classList.contains('secondary'), 'Fill demoted after a successful Fill');
      setVal('claude-plan', 'max5');
      eq(primaries(), 'calc-btn', 'plan chosen: Get project promoted, Fill demoted');
      setVal('claude-plan', '');
      eq(primaries(), '', 'plan cleared: back to zero primaries');
      setVal('claude-plan', 'max5');

      // Choosing a plan without a successful Fill does not promote Get project
      W.QP.app.clearAll();
      eq(primaries(), 'fill-usage-btn', 'clearAll restores Fill');
      ok($('calc-btn').classList.contains('secondary'), 'clearAll keeps Get project secondary');
    } finally {
      instantScroll(false);
      removeUsageBridge();
    }
  });

  test('Fill again after Mark done keeps Get project in view (390 and 1280)', async () => {
    const usage = fixtureUsage();
    for (const width of [390, 1280]) {
      await fresh();
      frame.style.width = width + 'px';
      await wait(80);
      installUsageBridge(() => ({ ok: true, usage: usage }));
      instantScroll(true);
      try {
        W.scrollTo(0, 0);
        $('fill-usage-btn').click();
        await flushFill();
        calc();
        cards()[0].querySelector('.done-btn').click();
        await wait(50);
        $('recalc-btn').click();
        await flushFill();
        await wait(50);
        eq(D.activeElement && D.activeElement.id, 'calc-btn', width + ' Fill again: focus on Get project');
        ok(inViewport($('calc-btn')), width + ' Fill again: Get project fully in view (' + Math.round($('calc-btn').getBoundingClientRect().bottom) + '/' + W.innerHeight + ')');
      } finally {
        instantScroll(false);
        removeUsageBridge();
        frame.style.width = '';
      }
    }
  });

  test('Reload in the done state keeps exactly one primary: Fill again', async () => {
    const usage = fixtureUsage();
    await fresh();
    installUsageBridge(() => ({ ok: true, usage: usage }));
    try {
      $('fill-usage-btn').click();
      await flushFill();
      calc();
      cards()[0].querySelector('.done-btn').click();
    } finally {
      removeUsageBridge();
    }
    await reloadApp();
    const primaries = shownButtons().filter(b => b.classList.contains('primary')).map(b => b.id).join();
    eq(primaries, 'recalc-btn', 'after reload in done state: only Fill again is primary');
  });

  test('已用/还剩同时管①和③：标签跟着变，每周和 5 小时用同一种算法', async () => {
    await fresh();
    const phrase = node => text(node).replace(/\s+/g, '');
    function labels() {
      return {
        h1: phrase(D.querySelector('.copy-slot[data-slot="1"] h3')),
        h3: phrase(D.querySelector('.copy-slot[data-slot="3"] h3')),
        d1: phrase(D.querySelector('.map-block[data-slot="1"] .mode-label')),
        d3: phrase(D.querySelector('.map-block[data-slot="3"] .mode-label')),
        a1: $('claude-s-pct').getAttribute('aria-label'),
        a3: $('claude-w-pct').getAttribute('aria-label')
      };
    }
    function expectMode(word, other) {
      const L = labels();
      Object.keys(L).forEach(k => {
        ok(L[k].indexOf(word) !== -1 && L[k].indexOf(other) === -1, k + ' 应是「' + word + '」：' + L[k]);
      });
    }
    expectMode('used', 'left');
    ok(text(D.querySelector('.copy-slot[data-slot="1"]')).indexOf('Session and Weekly percentages both use this.') !== -1, '写明两个百分比共用');

    pick('input[name="claude-mode"][value="left"]');
    expectMode('left', 'used');
    fill('claude', { mode: 'left', s: 85, w: 30 });
    calc();
    eq(resultOf('claude').dataset.band, 'medium', '85 和 30 按还剩算：每周也是还剩 30%，中档');
    expectMode('left', 'used');
    fill('claude', { mode: 'left', s: 15, w: 70 });
    calc();
    eq(resultOf('claude').dataset.band, 'small', '还剩 15/70 与已用 85/30 同一档');

    pick('input[name="claude-mode"][value="used"]');
    fill('claude', { mode: 'used', s: 85, w: 30 });
    calc();
    eq(resultOf('claude').dataset.band, 'small', '改回已用 85/30 是小档');
    expectMode('used', 'left');

    pick('input[name="claude-mode"][value="left"]');
    await reloadApp();
    ok(D.querySelector('input[name="claude-mode"][value="left"]').checked, '刷新后还是还剩');
    expectMode('left', 'used');

    $('example-btn').click();
    ok(D.querySelector('input[name="claude-mode"][value="used"]').checked, '示例回到已用');
    expectMode('used', 'left');

    pick('input[name="claude-mode"][value="left"]');
    $('clear-btn').click();
    ok(D.querySelector('input[name="claude-mode"][value="used"]').checked, '清除后回到已用');
    expectMode('used', 'left');
  });

  test('计算器：5 小时已用 85%、周已用 30% → 小档（有一个不到 20%），卡在 5 小时额度；推荐全是小档', async () => {
    await fresh();
    fill('claude', { s: 85, w: 30 });
    calc();
    const r = resultOf('claude');
    eq(r && r.dataset.band, 'small', '档位');
    ok(text(r).indexOf('Small') !== -1 && text(r).indexOf('About 15–30 minutes') !== -1, 'band chips');
    eq(D.querySelectorAll('#calc-results .result').length, 0, 'not a result card');
    eq(cards().length, 1, '主列表一张');
    eq(cards()[0].dataset.band, 'small', '卡片档位');
    ok(moreCards().length > 0 && moreCards().every(c => c.dataset.band === 'small'), '其余同档在 More projects');
    eq(cards().length + moreCards().length, bandCount('small'), '小档一张不落');
    eq($('recs-more').querySelector('summary').textContent.trim(), 'More projects');
  });

  test('计算器：5 小时已用 80%（剩 20%）→ 中档（20% 算中），推荐全是中档', async () => {
    await fresh();
    fill('claude', { s: 80, w: 30 });
    calc();
    const r = resultOf('claude');
    eq(r.dataset.band, 'medium', '档位');
    ok(text(r).indexOf('Medium') !== -1 && text(r).indexOf('About an hour') !== -1, 'band chips');
    eq(cards().length, 1, '主列表一张');
    eq(cards()[0].dataset.band, 'medium', '主推荐是中档');
    ok(moreCards().some(c => c.dataset.band === 'medium'), '其余中档在折叠里');
    ok(moreCards().some(c => c.dataset.band === 'small') && moreCards().every(c => c.dataset.band === 'medium' || c.dataset.band === 'small'), '更小的档并进同一个折叠');
  });

  test('计算器：两个窗口都剩一半以上、离每周重置超过 1 天 → 大档；推荐是大档，更小的放在折叠里', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    eq(resultOf('claude').dataset.band, 'large', '档位');
    ok(text(resultOf('claude')).indexOf('Large') !== -1 && text(resultOf('claude')).indexOf('About 2–3 hours') !== -1, 'band chips');
    eq(cards().length, 1, '主列表一张');
    eq(cards()[0].dataset.band, 'large', '主推荐是大档');
    ok(!$('recs-more').hidden, '有 More projects');
    ok(moreCards().some(c => c.dataset.band === 'large'), '其余大档在折叠里');
    ok(moreCards().some(c => c.dataset.band === 'small' || c.dataset.band === 'medium'), '更小的档在同一个折叠');
  });

  test('计算器：离每周额度重置只剩 20 分钟 → 只能小档，并写明是时间不够', async () => {
    await fresh();
    fill('claude', { s: 10, w: 10, day: 1, wclock: '10:20' });
    calc();
    const r = resultOf('claude');
    eq(r.dataset.band, 'small', '档位');
    ok(text(r).indexOf('Small') !== -1, 'band chip');
    cards().forEach(c => eq(c.dataset.band, 'small', '卡片档位'));
  });

  test('计算器：两个都剩 90%、离每周重置不到 1 天（22 小时）→ 中档，并写明原因', async () => {
    await fresh();
    fill('claude', { s: 10, w: 10, day: 2, wclock: '08:00' });
    calc();
    const r = resultOf('claude');
    eq(r.dataset.band, 'medium', '档位');
    ok(text(r).indexOf('Medium') !== -1, 'band chip');
    cards().forEach(c => eq(c.dataset.band, 'medium', '卡片档位'));
  });

  test('计算器：5 小时额度 20 分钟后重置不再压档 → 两个都剩 90% 还是大档', async () => {
    await fresh();
    fill('claude', { s: 10, w: 10, h: 0, m: 20 });
    calc();
    eq(resultOf('claude').dataset.band, 'large', '档位');
  });

  test('计算器：用钟点填 5 小时额度重置（10:30），卡在它上面 → 中档，并提醒重置后再算可能变大', async () => {
    await fresh();
    fill('claude', { s: 70, w: 10, clock: '10:30' });
    calc();
    const r = resultOf('claude');
    eq(r.dataset.band, 'medium', '档位');
    ok(text(r).indexOf('Medium') !== -1 && text(r).indexOf('About an hour') !== -1, 'band chips');
  });

  test('问卷 → 推荐：选旅行只出旅行；换成健康就跟着变；档位不变', async () => {
    await fresh();
    fill('claude', { s: 60, w: 20 }); // 有效剩余 40% → 中档
    calc();
    pick('input[name="q-domain"][value="travel"]');
    const travel = cards().map(c => c.dataset.id);
    ok(travel.length && travel.every(id => id.indexOf('travel-') === 0), '旅行：' + travel.join(','));
    unpick('input[name="q-domain"][value="travel"]');
    pick('input[name="q-domain"][value="health"]');
    const health = cards().map(c => c.dataset.id);
    ok(health.length && health.every(id => id.indexOf('health-') === 0), '健康：' + health.join(','));
    ok(travel.join() !== health.join(), '推荐跟着变了');
    cards().forEach(c => eq(c.dataset.band, 'medium', '档位'));
    ok(statusText().indexOf('Area: Health') !== -1, '状态里写了按什么挑的');
  });

  test('问卷：大档 + 生活和创作 → 推荐跟着领域走，且不会出现超过档位的', async () => {
    await fresh();
    fill('claude', { s: 0, w: 0 });
    calc();
    pick('input[name="q-domain"][value="life"]');
    pick('input[name="q-domain"][value="create"]');
    eq(cards().length, 1, '主列表一张');
    eq(cards()[0].dataset.id, 'life-budget', '生活和创作里排第一的');
    ok(moreCards().some(c => c.dataset.id === 'create-memory-book'), '另一张同档在 More projects');
    ok(cards().concat(moreCards()).every(c => c.dataset.band === 'large' || c.dataset.band === 'medium' || c.dataset.band === 'small'), '没有超出大档');
  });

  test('问题 2 写想做的事 → 多一张按这件事做的卡；原话照原样显示，不会被当成网页代码执行', async () => {
    await fresh();
    fill('claude', { s: 60, w: 20 });
    calc();
    const wish = '<img src=x onerror="window.__xss=1">给妈妈过生日';
    setVal('q-wish', wish);
    await wait(50);
    const mine = cards().concat(moreCards()).find(c => c.dataset.id.indexOf('custom:') === 0);
    ok(mine, '有自定义卡');
    eq(mine.dataset.band, 'medium', '自定义卡的档位');
    ok(text(mine).indexOf(wish) !== -1, '原话照原样显示');
    eq(D.querySelectorAll('#recs img').length, 0, '没有被当成图片标签');
    ok(!W.__xss, '没有执行');
  });

  // ---------------- 偏好推荐：大 / 中 / 小 × 填偏好 / 跳过偏好 ----------------

  test('偏好 × 大档：旅行 + 一份计划 + 给家人 → 第一张是 5–7 天旅行、标「最贴合你」、写着对上的 3 点；没对上的同档项目在折叠里', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    pick('input[name="q-domain"][value="travel"]');
    pick('input[name="q-output"][value="plan"]');
    pick('input[name="q-audience"][value="family"]');
    eq(cards().length, 1, '主列表只有一张');
    const first = cards()[0];
    eq(first.dataset.id, 'travel-trip', '第一张');
    ok(!first.querySelector('.badge') && !first.querySelector('.top-tag'), '没有档位和 Best match 芯片');
    const why = whyOf(first);
    ok(/Travel/.test(why) && /A plan/.test(why) && /Family, friends, or kids/.test(why), why);
    eq(first.querySelector('.done-btn').textContent.trim(), 'Mark done');
    ok(!$('recs-more').hidden, '其余项目在 More projects');
    eq($('recs-more').querySelector('summary').textContent.trim(), 'More projects');
    moreCards().forEach(c => {
      if (whyOf(c).indexOf('preferences don’t') !== -1) eq(c.dataset.band, 'large', c.dataset.id + ' 没对上的仍是同档');
    });
    eq(cards().concat(moreCards()).filter(c => c.dataset.band === 'large').length, bandCount('large'), '同一档一个不少');
    ok(moreCards().some(c => c.dataset.band !== 'large'), '更小的档在同一个折叠');
    ok(statusText().indexOf('Outcome: A plan') !== -1 && statusText().indexOf('For: Family, friends, or kids') !== -1, '状态里写了按什么排的');
  });

  test('偏好 × 中档：只选「一张表或清单」→ 对上的排前面；换成「弄懂或练熟一件事」→ 排序跟着变；都不超档', async () => {
    await fresh();
    fill('claude', { s: 60, w: 20 }); // 有效剩余 40% → 中档
    calc();
    pick('input[name="q-output"][value="list"]');
    eq(cards().length, 1, '主列表一张');
    eq(cards()[0].dataset.id, 'work-checklist', '表 / 清单：第一张');
    ok(W.QP.PROJECTS.find(p => p.id === cards()[0].dataset.id).outputs.indexOf('list') !== -1, '主推荐是表或清单');
    unpick('input[name="q-output"][value="list"]');
    pick('input[name="q-output"][value="learn"]');
    eq(cards().length, 1, '换成练熟后仍是一张');
    eq(cards()[0].dataset.id, 'work-interview', '弄懂 / 练熟：第一张');
    ok(cards()[0].dataset.id !== 'work-checklist', '排序跟着变了');
    cards().concat(moreCards()).filter(c => c.dataset.band === 'medium').forEach(c => eq(c.dataset.band, 'medium', c.dataset.id + ' 档位'));
    ok(moreCards().some(c => c.dataset.band === 'small'), '更小的档在 More projects');
    moreCards().filter(c => c.dataset.band === 'small').forEach(c => eq(c.dataset.band, 'small', c.dataset.id));
  });

  test('偏好 × 小档：选「工作上要用」→ 第一张是写工作消息，标「最贴合你」；其余小档在折叠里', async () => {
    await fresh();
    fill('claude', { s: 85, w: 30 });
    calc();
    pick('input[name="q-audience"][value="work"]');
    eq(cards().length, 1, '主列表一张');
    eq(cards()[0].dataset.id, 'work-message', '第一张');
    ok(whyOf(cards()[0]).indexOf('For work') !== -1, '写着对上了 For work');
    cards().concat(moreCards()).forEach(c => eq(c.dataset.band, 'small', c.dataset.id + ' 档位'));
    eq(cards().length + moreCards().length, bandCount('small'), '同一档一个不少');
    ok(moreCards().every(c => c.dataset.band === 'small'), '小档下面没有更小的');
  });

  test('跳过偏好：点「跳过，直接看推荐」→ 到第 3 步；大、中、小三档都只按档位出推荐，每张卡写着是按档位挑的', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    $('skip-btn').click();
    eq(D.activeElement && D.activeElement.id, 'recs-title', '光标到了第 3 步');
    [[30, 'large'], [60, 'medium'], [85, 'small']].forEach(c => {
      setVal('claude-s-pct', String(c[0]));
      calc();
      eq(resultOf('claude').dataset.band, c[1], '档位');
      eq(cards().length, 1, c[1] + '：主列表一张');
      cards().forEach(n => {
        eq(n.dataset.band, c[1], n.dataset.id + ' 档位');
        ok(whyOf(n).indexOf('In list order for this size.') !== -1, n.dataset.id + ' 写着按档位挑');
        ok(!n.querySelector('.top-tag') && !n.querySelector('.badge'), n.dataset.id + ' 没有芯片');
      });
      eq(cards().concat(moreCards()).filter(n => n.dataset.band === c[1]).length, bandCount(c[1]), c[1] + '：其余同档在 More projects');
      ok(!$('recs-more').hidden, 'More projects 收着其余的');
      ok(statusText().indexOf('No preferences yet. Picks go in list order.') !== -1, '状态里说了还没有偏好');
      eq($('skip-btn').textContent.trim(), 'Skip to recommendations');
    });
  });

  test('做完一个就重新算，一直到额度用完：大 → 中 → 小 → 用完；偏好一直保留，做完的不再推，横幅写着离每周重置还有多久', async () => {
    await fresh();
    pick('input[name="q-output"][value="plan"]');
    fill('claude', { s: 30, w: 40 });
    const done = [];
    const rounds = [[30, 'large'], [60, 'medium'], [85, 'small'], [100, 'none']];
    for (const [used, band] of rounds) {
      setVal('claude-s-pct', String(used));
      calc();
      ok($('done-banner').hidden, band + '：重新算完，提示消失');
      eq(resultOf('claude').dataset.band, band, '这一轮的档位');
      if (band === 'none') {
        eq(cards().length, 0, '用完了不推');
        ok(statusText().indexOf('nothing left') !== -1 && statusText().indexOf('Session') !== -1, '告诉你等哪个重置');
        break;
      }
      ok(D.querySelector('input[name="q-output"][value="plan"]').checked, band + '：偏好还在');
      cards().forEach(c => {
        eq(c.dataset.band, band, c.dataset.id + ' 档位');
        ok(done.indexOf(c.dataset.id) === -1, c.dataset.id + ' 做完的不再推');
      });
      if (done.length) ok(statusText().indexOf('Finished ' + done.length + ' this round') !== -1, '记着做完了几个');
      const c = cards()[0];
      done.push(c.dataset.id);
      c.querySelector('.done-btn').click();
      ok(!$('done-banner').hidden, '出现「做完了」');
      ok(text($('done-banner')).indexOf('Marked done. Fill again after your next session.') !== -1, text($('done-banner')));
      eq($('recalc-btn').textContent.trim(), 'Fill again');
      eq(cards().length, 0, '重新算之前不推');
    }
    eq(done.length, 3, '三轮各做完一个');
  });

  test('同一档一个个做完：对上的做完后退回列出这一档其余的；全做完只说「都做完了」，不再说「先列出来」', async () => {
    await fresh();
    fill('claude', { s: 85, w: 30 }); // 小档
    calc();
    pick('input[name="q-audience"][value="work"]');
    const total = bandCount('small');
    for (let i = 0; i < total; i++) {
      eq(cards().length + moreCards().length, total - i, '第 ' + (i + 1) + ' 轮还剩几张（主推荐 + More projects）');
      eq(cards().length, 1, '主列表始终一张');
      if (i === 0) eq(cards()[0].dataset.id, 'work-message', '一开始是对上「工作上要用」的那张');
      if (i === 1) {
        ok(statusText().indexOf('Nothing this size matches') !== -1, '对上的做完了 → 说明是退回列出这一档的');
        eq(moreCards().length, total - i - 1, '其余的在 More projects');
      }
      cards()[0].querySelector('.done-btn').click();
      calc();
    }
    eq(cards().length, 0, '全做完了');
    ok(statusText().indexOf('finished every ready-made project') !== -1, '告诉你都做完了');
    ok(statusText().indexOf('Nothing this size matches') === -1, '不再说先列出来');
    setVal('q-wish', '整理衣柜');
    eq(cards().length, 1, '写了想做的事 → 只剩那张现做的');
    ok(cards()[0].dataset.id === 'custom:整理衣柜', '是现做的那张');
    ok(statusText().indexOf('card built from what you wrote') !== -1 && statusText().indexOf('Nothing this size matches') === -1, statusText());
  });

  test('做完一个 → 提示回去重新算 → 重新算后推下一个，做完的不再出现', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 }); // 大档
    calc();
    const first = cards()[0];
    const doneId = first.dataset.id;
    first.querySelector('.done-btn').click();
    ok(!$('done-banner').hidden, '出现「做完了」提示');
    ok(text($('done-banner')).indexOf('Fill again after your next session.') !== -1, '提示再 Fill 一次');
    eq(cards().length, 0, '重新算之前不推下一个');
    ok(!$('done-banner').hidden && !$('recs').hidden, 'Fill again banner visible');
    ok($('stale-warn') && $('stale-warn').hidden, 'stale warning hidden while the banner is visible');
    // Stale but the banner is not on screen: the warning must still show.
    $('done-banner').hidden = true;
    W.QP.app.renderResults();
    W.QP.app.syncStaleWarning();
    ok(W.QP.app.state.stale, 'still stale');
    ok($('stale-warn') && !$('stale-warn').hidden && isShown($('stale-warn')), 'stale warning shows when the banner is hidden');
    ok(text($('calc-results')).indexOf('These numbers are out of date.') !== -1, 'warning copy');
    $('done-banner').hidden = false;
    W.QP.app.syncStaleWarning();
    ok($('stale-warn').hidden, 'banner back → warning hidden again');
    $('recalc-btn').click();
    eq(D.activeElement && D.activeElement.id, 'fill-usage-btn', 'Fill again 回到 Fill 按钮');
    eq($('fill-status').textContent, 'Reading Usage…', 'Fill again 直接触发 Fill');
    ok($('done-banner').hidden, 'Fill again 先收起「做完了」提示');
    eq($('claude-s-pct').value, '', 'Fill again 清掉旧数字');
    fill('claude', { s: 60, w: 40 }); // 做完项目用掉了一些：剩 40% → 中档
    calc();
    ok($('done-banner').hidden, '提示消失');
    eq(resultOf('claude').dataset.band, 'medium', '新档位');
    ok(cards().length > 0, '推了下一批');
    ok(cards().every(c => c.dataset.id !== doneId && c.dataset.band === 'medium'), '没有做完的，档位跟着新剩余');
    ok(statusText().indexOf('Finished 1 this round') !== -1, '记着做完了几个');
  });

  test('Fill again after Mark done (#21): clears done state and old numbers, keeps plan, one status at a time', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    const planBefore = $('claude-plan').value;
    ok(planBefore !== '', 'a plan is chosen');
    cards()[0].querySelector('.done-btn').click();
    ok(!$('done-banner').hidden, 'Marked done banner shows');
    $('recalc-btn').click();
    ok($('done-banner').hidden, 'Fill again hides the Marked done banner');
    ok(!W.QP.app.state.stale, 'done state cleared');
    eq($('claude-s-pct').value, '', 'old Session % cleared');
    eq($('claude-w-pct').value, '', 'old Weekly % cleared');
    eq($('claude-plan').value, planBefore, 'plan kept');
    eq(text($('calc-results')).trim(), '', 'old result cleared');
    await wait(1700);
    eq($('fill-status').textContent, FILL_NO_EXT, 'no extension message');
    ok($('done-banner').hidden, 'still no Marked done next to the error');
    const shownMsgs = Array.from(D.querySelectorAll('#done-banner, #fill-status, #stale-warn, #restore-note')).filter(isShown);
    eq(shownMsgs.length, 1, 'one status message on screen');
    ok(isShown($('usage-fields')), 'Fill again with no extension opens the manual fields (#23)');
    ok(isShown($('claude-s-pct')), 'Session % visible to type by hand');
    ok(isShown($('calc-btn')), 'Get project reachable by hand');
    eq(D.activeElement, $('claude-s-pct'), 'focus lands on Session %');
    eq(W.QP.app.state.done.length, 1, 'finished count kept');
  });

  test('问卷没有 ChatGPT，也没有服务单选', async () => {
    await fresh();
    eq(D.querySelectorAll('input[name="q-service"]').length, 0);
    eq(D.querySelectorAll('#quiz input[value="chatgpt"]').length, 0);
    ok(text($('quiz')).indexOf('ChatGPT') === -1, text($('quiz')));
  });

  test('按 API 用量付钱 → 写明不适用，不出档位', async () => {
    await fresh();
    setVal('claude-plan', 'api');
    ok(!$('claude-api').hidden && $('claude-body').hidden, '显示不适用，隐藏输入');
    calc();
    ok(text(resultOf('claude')).indexOf('no session/weekly window') !== -1, '结果写不适用');
    ok(text($('claude-api')).indexOf('no session/weekly window') !== -1, '表单上的警告');
    eq(cards().length, 0, '不推项目');
  });

  test('填错了 → 指出是哪一格', async () => {
    await fresh();
    fill('claude', { s: 150, w: 30 });
    setVal('claude-w-day', '');
    calc();
    eq($('claude-s-pct').getAttribute('aria-invalid'), 'true', '百分比标红');
    eq($('claude-w-day').getAttribute('aria-invalid'), 'true', '周几标红');
    ok(resultOf('claude') && !resultOf('claude').classList.contains('result') && !resultOf('claude').classList.contains('card'), 'error is not a card');
    ok(text(resultOf('claude')).indexOf('Missing Session / Resets in / Weekly') !== -1, '结果标题');
    ok(text(resultOf('claude')).indexOf('Session % must be 0–100.') !== -1, 'Session 百分比');
    ok(text(resultOf('claude')).indexOf('Weekday is empty.') !== -1, '周几');
    eq(cards().length, 0, '不推');
  });

  test('三个数都空着：说哪一格还空着，不把空着说成填错', async () => {
    await fresh();
    setVal('claude-plan', 'pro');
    setVal('claude-s-h', '');
    setVal('claude-s-m', '');
    calc();
    const t = text(resultOf('claude'));
    ok(t.indexOf('Session % is empty.') !== -1, 'Session empty: ' + t);
    ok(t.indexOf('Weekly % is empty.') !== -1, 'Weekly empty: ' + t);
    ok(t.indexOf('Weekday is empty.') !== -1, 'weekday empty: ' + t);
    ok(t.indexOf('must be 0–100') === -1, 'empty is not an out-of-range number');
    eq(cards().length, 0, '不推');
    ok(statusText().indexOf('Finish Session, Resets in, and Weekly') !== -1, statusText());
  });

  test('额度用完 → 不推项目，告诉你等多久', async () => {
    await fresh();
    fill('claude', { s: 20, w: 100 });
    calc();
    eq(resultOf('claude').dataset.band, 'none', '档位');
    eq(cards().length, 0, '不推');
    ok(statusText().indexOf('nothing left') !== -1 && statusText().indexOf('Weekly') !== -1, '告诉你等哪个');
  });

  test('改了数字没重新算 → 第 1 步和第 3 步都提示点「算一下」', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    setVal('claude-s-pct', '90');
    ok(text($('calc-results')).indexOf('Click Get project to update') !== -1, '第 1 步提示');
    ok(statusText().indexOf('haven’t clicked Get project') !== -1, '第 3 步提示');
    calc();
    ok(statusText().indexOf('haven’t clicked Get project') === -1, '算完提示消失');
  });

  test('全角数字（中文输入法）能算', async () => {
    await fresh();
    fill('claude', { s: '８５', w: '３０' });
    calc();
    eq(resultOf('claude').dataset.band, 'small', '档位');
  });

  test('项目库里每一个项目卡都能正常显示：档位、为什么推给你、目标产出、大概步骤、验收标准都在', async () => {
    await fresh();
    fill('claude', { s: 0, w: 0 }); // 大档、不填问卷 → 主推荐 7 个大档 + 折叠里 18 个更小的
    calc();
    const all = cards().concat(moreCards());
    eq(cards().length, 1, '主列表一张');
    eq(new Set(all.map(c => c.dataset.id)).size, W.QP.PROJECTS.length, '项目数');
    all.forEach(c => {
      ok(!c.querySelector('dl'), c.dataset.id + ' 不是一堵定义列表');
      ok(!c.querySelector('.badge') && !c.querySelector('.top-tag') && !c.querySelector('.done-when'), c.dataset.id + ' 没有芯片');
      ok(whyOf(c).length > 0, c.dataset.id + ' 一行为什么');
      eq(c.querySelectorAll('.why li').length, 0, c.dataset.id + ' 没有分条 Why');
      const steps = c.querySelector('details.steps');
      ok(steps && !steps.open, c.dataset.id + ' 步骤默认收起');
      eq(steps.querySelector('summary').textContent.trim(), 'Show steps', c.dataset.id);
      ok(steps.querySelectorAll('ol li').length >= 3, c.dataset.id + ' 步骤');
      ok(c.querySelector('h3').textContent.length > 0, c.dataset.id + ' 标题');
      eq(c.querySelector('.done-btn').textContent.trim(), 'Mark done', c.dataset.id);
    });
    ok(!/[\u4e00-\u9fff]/.test(text($('recs'))), '推荐区没有中文');
  });

  test('清除我的回答：问卷、数字、做完的记录全部清掉', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    pick('input[name="q-domain"][value="work"]');
    setVal('q-other', '养猫');
    setVal('q-wish', '整理照片');
    pick('input[name="q-output"][value="list"]');
    pick('input[name="q-audience"][value="family"]');
    cards()[0].querySelector('.done-btn').click();
    ok(W.sessionStorage.getItem('qp-v0'), '清除前有存');
    $('clear-btn').click();
    eq($('claude-plan').value, '', '服务档位');
    eq($('claude-s-pct').value, '', '百分比');
    eq(D.querySelectorAll('input[name="q-domain"]:checked').length, 0, '领域');
    eq(D.querySelectorAll('input[name="q-output"]:checked, input[name="q-audience"]:checked').length, 0, '成果、给谁');
    eq($('q-other').value + $('q-wish').value, '', '自己写的');
    eq(D.querySelectorAll('input[name="q-service"]').length, 0, '没有服务题');
    eq(text($('calc-results')).trim(), '', '计算结果回到空状态');
    eq(D.querySelector('main').dataset.phase, 'first', '清除后回到第一屏');
    ok(!isShown($('usage-fields')), 'plan and grid hidden again');
    ok($('band-chips').hidden, 'chips hidden');
    ok($('done-banner').hidden, '做完提示');
    eq(cards().length, 0, '推荐');
    eq(W.sessionStorage.getItem('qp-v0'), null, '存的东西');
    eq(W.QP.app.state.done.length, 0, '做完的记录');
    ok(!$('clear-msg').hidden, '告诉用户已清除');
  });

  test('刷新页面：同一个标签页里填的会带回来；清除后再刷新什么都不剩', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    pick('input[name="q-domain"][value="hobby"]');
    pick('input[name="q-output"][value="fun"]');
    pick('input[name="q-audience"][value="self"]');
    await reloadApp();
    eq($('claude-plan').value, 'pro', '服务档位带回');
    eq($('claude-s-pct').value, '30', '百分比带回');
    ok(D.querySelector('input[name="q-domain"][value="hobby"]').checked, '领域带回');
    ok(D.querySelector('input[name="q-output"][value="fun"]').checked, '成果带回');
    ok(D.querySelector('input[name="q-audience"][value="self"]').checked, '给谁带回');
    ok(!$('restore-note').hidden, '提示对照用量页再算');
    eq(text($('restore-note')).trim(), 'Fields restored. Get project to see it again.', 'restore hint copy');
    W.QP.app.clearAll();
    await reloadApp();
    eq($('claude-plan').value, '', '清除后没有带回');
    ok($('restore-note').hidden, '没有提示');
  });

  // ---------------- Copy for Claude (#27) ----------------

  const COPY_LABEL = 'Copy for Claude';
  const COPY_DONE = 'Copied. Go paste.';
  const COPY_SAID = 'Copied. Paste it into Claude.';
  const COPY_HINT = 'Press ⌘C / Ctrl+C';

  // The issue's plain-text format, written out here so these checks do not reuse core.
  function copyText(p) {
    return p.title + '\n\n' + 'What you’ll end with: ' + p.output + '\n\n' + 'Steps:\n' +
      p.steps.map((s, i) => (i + 1) + '. ' + s).join('\n') + '\n\n' + 'Done when: ' + p.done;
  }

  // Puts clip where the app iframe reads navigator.clipboard (undefined: no clipboard at all).
  // Returns a function that brings back the browser's own.
  function setClipboard(clip) {
    const nav = W.navigator;
    Object.defineProperty(nav, 'clipboard', { configurable: true, get: () => clip });
    return () => { delete nav.clipboard; };
  }
  // A clipboard whose writeText records each text and returns clip.reply(); swap reply to
  // change how the next write ends.
  function fakeClipboard(reply) {
    const clip = { writes: [], reply: reply };
    clip.writeText = t => {
      clip.writes.push(t);
      return clip.reply(t);
    };
    return clip;
  }
  const writeOk = () => W.Promise.resolve();
  const writeDenied = () => W.Promise.reject(new W.DOMException('Write permission denied.', 'NotAllowedError'));

  const copyBtnOf = c => c.querySelector('.copy-btn');
  const liveOf = c => c.querySelector('[aria-live="polite"]');
  const shownAreas = c => Array.from(c.querySelectorAll('textarea')).filter(isShown);
  const projectOf = c => W.QP.PROJECTS.find(p => p.id === c.dataset.id);

  // Headless virtual time can ignore element.focus() while the iframe window is not active,
  // and can drop that focus across the 1s write timer. Focus the iframe first. atWriteTimeout
  // wraps that timer: around(fn) runs in the same turn and must call fn() so showFallback
  // reads the focus a real click would still have.
  function focusInApp(el) {
    W.focus();
    el.focus({ preventScroll: true });
  }
  function atWriteTimeout(around) {
    const realSet = W.setTimeout;
    W.setTimeout = function (fn, ms) {
      if (ms !== 1000) return realSet.apply(W, arguments);
      return realSet.call(W, function () { around(fn); }, ms);
    };
    return () => { W.setTimeout = realSet; };
  }
  function focusOnClick(el) {
    const fn = () => focusInApp(el);
    el.addEventListener('click', fn, true);
    return () => el.removeEventListener('click', fn, true);
  }

  // Every change of node's text, in order. A live region cleared and then given the same
  // words again shows up twice: that is what makes a screen reader say it again.
  function watchText(node) {
    let last = node.textContent;
    const seen = [];
    const mo = new W.MutationObserver(() => {
      const now = node.textContent;
      if (now !== last) seen.push(now);
      last = now;
    });
    mo.observe(node, { childList: true, characterData: true, subtree: true });
    return { seen: seen, stop: () => mo.disconnect() };
  }

  // What Copy must leave alone: app state, what the tab saved, the step 1 and quiz fields,
  // the phase, the done banner, which cards are drawn, and the scroll position.
  function untouched() {
    return JSON.stringify({
      state: W.QP.app.state,
      saved: W.sessionStorage.getItem('qp-v0'),
      fields: Array.from(D.querySelectorAll('#calc-form input, #calc-form select, #quiz-form input'))
        .map(n => (n.type === 'radio' || n.type === 'checkbox' ? n.checked : n.value)),
      phase: D.querySelector('main').dataset.phase,
      banner: $('done-banner').hidden,
      cards: cards().concat(moreCards()).map(c => c.dataset.id),
      scroll: W.scrollY
    });
  }

  // A hero from typed numbers (Medium by default). Call with instantScroll(true) on, so the
  // scroll Get project makes lands at once.
  async function heroForCopy(o) {
    await fresh();
    fill('claude', o || { s: 72, h: 3, m: 12, w: 31 });
    calc();
    await wait(0);
    const hero = cards()[0];
    ok(hero && hero.classList.contains('hero'), 'hero rendered');
    return hero;
  }

  test('Copy for Claude: on the hero after Get project, before Mark done (left of it, or above it on narrow screens); secondary, Mark done keeps its primary style; native button; Tab goes on to Mark done; visible focus ring', async () => {
    instantScroll(true);
    try {
      await fresh();
      eq(D.querySelectorAll('.copy-btn').length, 0, 'no Copy for Claude before Get project');
      const hero = await heroForCopy();
      const copy = copyBtnOf(hero);
      const done = hero.querySelector('.done-btn');
      ok(copy && isShown(copy), 'Copy for Claude shows on the hero');
      eq(copy.textContent, COPY_LABEL, 'label');
      eq(Array.from(hero.querySelectorAll('button')).map(b => b.textContent.trim()).join(' | '), 'Copy for Claude | Mark done', 'order in the card');
      eq(copy.tagName + ' type=' + copy.getAttribute('type'), 'BUTTON type=button', 'native button');
      ok(copy.classList.contains('secondary') && !copy.classList.contains('primary') && !copy.classList.contains('done-btn'), 'secondary: ' + copy.className);
      eq(done.className, 'done-btn', 'Mark done keeps .done-btn');
      eq(hero.querySelectorAll('.primary').length, 0, 'no .primary in the card: Mark done is the card\'s primary');
      const cs = W.getComputedStyle(copy);
      const ds = W.getComputedStyle(done);
      eq(ds.backgroundColor, 'rgb(43, 106, 87)', 'Mark done keeps the accent fill');
      eq(ds.color, 'rgb(255, 255, 255)', 'Mark done keeps white text');
      eq(cs.backgroundColor, 'rgb(255, 255, 255)', 'Copy for Claude is a white secondary button');
      ok(Number(cs.fontWeight) < Number(ds.fontWeight), 'Mark done is bolder (' + ds.fontWeight + ' vs ' + cs.fontWeight + ')');

      ok(!Array.from(D.querySelectorAll('[tabindex]')).some(n => n.tabIndex > 0), 'no positive tabindex: Tab follows page order');
      const stops = Array.from(D.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]'))
        .filter(n => n.tabIndex >= 0 && !n.disabled && isShown(n));
      ok(stops.indexOf(copy) !== -1, 'Copy for Claude is a Tab stop');
      eq(stops[stops.indexOf(copy) + 1], done, 'the Tab stop after Copy for Claude is Mark done');

      copy.focus({ preventScroll: true });
      eq(D.activeElement, copy, 'focusable');
      const ring = W.getComputedStyle(copy);
      ok(ring.outlineStyle === 'solid' && parseFloat(ring.outlineWidth) >= 2 && ring.outlineColor !== 'rgba(0, 0, 0, 0)',
        'visible focus ring: ' + ring.outlineStyle + ' ' + ring.outlineWidth + ' ' + ring.outlineColor);
      copy.blur();

      // Each label on one line; side by side when there is room; never past the card.
      async function layout(width) {
        frame.style.width = width + 'px';
        await wait(80);
        const c = cards()[0];
        const btn = copyBtnOf(c);
        const a = btn.getBoundingClientRect();
        const b = c.querySelector('.done-btn').getBoundingClientRect();
        const box = c.getBoundingClientRect();
        const label = D.createRange();
        label.selectNodeContents(btn);
        eq(label.getClientRects().length, 1, width + 'px: Copy for Claude fits on one line');
        ok(a.left >= box.left - 0.5 && Math.max(a.right, b.right) <= box.right + 0.5, width + 'px: both buttons inside the card');
        ok(D.documentElement.scrollWidth <= W.innerWidth + 1, width + 'px: no horizontal scroll');
        ok(b.width >= a.width - 1, width + 'px: Mark done is not narrower than Copy for Claude');
        const row = Math.abs(a.top - b.top) < 1;
        if (row) ok(a.right <= b.left, width + 'px: Copy for Claude left of Mark done');
        else ok(a.bottom <= b.top, width + 'px: stacked, Copy for Claude above Mark done');
        return row;
      }
      ok(await layout(1280), '1280px: side by side');
      await layout(375);
      await layout(320);
    } finally {
      frame.style.width = '';
      instantScroll(false);
    }
  });

  test('Copy for Claude (built-in hero): writes exactly the project text; label says Copied for 2s, a second click restarts the 2s (one revert); live region says it once per click; focus stays; nothing else changes; Mark done and Fill again work as before', async () => {
    instantScroll(true);
    const clip = fakeClipboard(writeOk);
    const restore = setClipboard(clip);
    let spy = null;
    let label = null;
    let said = null;
    try {
      const hero = await heroForCopy();
      const copy = copyBtnOf(hero);
      const live = liveOf(hero);
      const p = projectOf(hero);
      ok(copy && live && p, 'button, live region, catalog project ' + hero.dataset.id);
      eq(hero.querySelectorAll('[aria-live]').length, 1, 'one live region in the card');
      ok(isShown(live), 'live region is rendered (visually hidden is fine), so screen readers get it');
      eq(live.textContent, '', 'live region starts quiet');
      W.scrollTo(0, 150);
      await wait(0);
      copy.focus({ preventScroll: true });
      const before = untouched();
      spy = spyScrollFocus();
      label = watchText(copy);
      said = watchText(live);

      copy.click();
      await wait(0);
      eq(clip.writes.length, 1, 'one clipboard write');
      eq(clip.writes[0], copyText(p), 'exact text of ' + p.id);
      eq(copy.textContent, COPY_DONE, 'label once the write resolves');
      await wait(150);
      eq(live.textContent, COPY_SAID, 'live region says the full sentence');
      await wait(850);
      eq(copy.textContent, COPY_DONE, 'still Copied 1s later');
      copy.click();
      await wait(0);
      eq(clip.writes.length, 2, 'second click writes again');
      eq(clip.writes[1], clip.writes[0], 'same text');
      await wait(1500);
      eq(copy.textContent, COPY_DONE, '2.5s after the first click, 1.5s after the second: still Copied (first 2s timer dropped)');
      await wait(700);
      eq(copy.textContent, COPY_LABEL, 'back to Copy for Claude 2.2s after the second click');
      await wait(2100);
      eq(label.seen.join(' → '), COPY_DONE + ' → ' + COPY_LABEL, 'one swap and exactly one revert');
      eq(said.seen.filter(t => t === COPY_SAID).length, 2, 'announced once per click: ' + JSON.stringify(said.seen));
      ok(said.seen.every(t => t === COPY_SAID || t === ''), 'nothing else announced: ' + JSON.stringify(said.seen));
      eq(live.textContent, '', 'live region quiet again after the revert');
      eq(D.activeElement, copy, 'focus stays on the button');
      eq(spy.log.length, 0, 'no scrollIntoView and no focus calls: ' + spy.log.map(e => e.kind + ' ' + nodeName(e.node)).join(', '));
      eq(untouched(), before, 'state, saved state, fields, phase, banner, cards and scroll unchanged');
      ok(cards()[0] === hero && hero.isConnected, 'card not re-drawn');
      eq(shownAreas(hero).length, 0, 'no textarea after a successful copy');
      eq(W.QP.app.state.done.length, 0, 'copying marks nothing done');

      // Mark done and Fill again after copying: same as without it.
      hero.querySelector('.done-btn').click();
      eq(W.QP.app.state.done.join(), p.id, 'Mark done marks this project');
      ok(!$('done-banner').hidden && cards().length === 0, 'done banner, no card until Fill again');
      eq(D.activeElement, $('recalc-btn'), 'focus on Fill again');
      $('recalc-btn').click();
      ok($('done-banner').hidden && !W.QP.app.state.stale, 'Fill again clears the done state');
      eq($('claude-s-pct').value, '', 'Fill again clears the old numbers');
      eq($('fill-status').textContent, FILL_WORKING, 'Fill again runs Fill');
    } finally {
      if (label) label.stop();
      if (said) said.stop();
      if (spy) spy.restore();
      restore();
      instantScroll(false);
    }
  });

  test('Copy for Claude: the custom card copies its own text (core.customProject); a More projects card copies its own project', async () => {
    instantScroll(true);
    const clip = fakeClipboard(writeOk);
    const restore = setClipboard(clip);
    try {
      await heroForCopy({ s: 60, w: 20 }); // 40% left → Medium
      setVal('q-wish', 'organize the closet');
      const hero = cards()[0];
      eq(hero.dataset.id, 'custom:organize the closet', 'the custom card is the hero');
      copyBtnOf(hero).click();
      await wait(0);
      const mine = W.QP.core.customProject('organize the closet', hero.dataset.band);
      eq(clip.writes[0], copyText(mine), 'custom card text');
      eq(clip.writes[0].split('\n')[0], text(hero.querySelector('h3')), 'first line is the title on the card');
      eq(clip.writes[0].split('\n')[0], 'Make a first piece of “organize the closet”', 'Medium custom title');
      eq(copyBtnOf(hero).textContent, COPY_DONE, 'the custom card says Copied');

      $('overflow').open = true;
      $('recs-more').open = true;
      await wait(0);
      const other = moreCards().find(c => projectOf(c));
      ok(other, 'a catalog card in More projects');
      const otherBtn = copyBtnOf(other);
      ok(otherBtn && isShown(otherBtn), 'More projects cards have Copy for Claude too');
      otherBtn.click();
      await wait(0);
      eq(clip.writes.length, 2, 'one write per click');
      eq(clip.writes[1], copyText(projectOf(other)), 'a More projects card copies its own project (' + other.dataset.id + ')');
      eq(otherBtn.textContent, COPY_DONE, 'that card says Copied');
      eq(W.QP.app.state.done.length, 0, 'nothing marked done');
    } finally {
      $('overflow').open = false;
      $('recs-more').open = false;
      restore();
      instantScroll(false);
    }
  });

  test('Copy for Claude when the write fails (writeText rejects): read-only textarea under the button, all text selected, ⌘C / Ctrl+C hint; focus moves there without scrolling; a second failure reuses it; a later success hides it', async () => {
    instantScroll(true);
    const clip = fakeClipboard(writeDenied);
    const restore = setClipboard(clip);
    frame.style.height = '600px';
    let spy = null;
    let said = null;
    let unfocus = () => {};
    try {
      const hero = await heroForCopy();
      const copy = copyBtnOf(hero);
      const live = liveOf(hero);
      const want = copyText(projectOf(hero));
      eq(shownAreas(hero).length, 0, 'no textarea before a failed copy');
      // Park the buttons on the bottom edge: what opens under them starts below the fold,
      // so any scroll to show it would move the page.
      W.scrollTo(0, W.scrollY + copy.getBoundingClientRect().bottom - W.innerHeight + 2);
      await wait(0);
      const y = W.scrollY;
      ok(y > 0, 'page scrolled down to the buttons');
      focusInApp(copy);
      const before = untouched();
      spy = spyScrollFocus();
      said = watchText(live);
      unfocus = focusOnClick(copy);

      copy.click();
      await wait(0);
      eq(clip.writes.length, 1, 'tried the clipboard first');
      eq(clip.writes[0], want, 'with the full text');
      const areas = shownAreas(hero);
      eq(areas.length, 1, 'one textarea opens');
      const ta = areas[0];
      ok(ta.readOnly, 'read-only');
      eq(ta.value, want, 'holds the full text');
      eq(ta.selectionStart + '–' + ta.selectionEnd, '0–' + want.length, 'all of it selected');
      eq(D.activeElement, ta, 'focus moves to the textarea');
      const tRect = ta.getBoundingClientRect();
      ok(tRect.top >= copy.getBoundingClientRect().bottom - 0.5, 'under the button');
      ok(tRect.top >= W.innerHeight - 4, 'opened below the fold (top ' + Math.round(tRect.top) + ' of ' + W.innerHeight + ')');
      eq(W.scrollY, y, 'the page did not scroll');
      eq(spy.log.filter(e => e.kind === 'scroll').length, 0, 'no scrollIntoView');
      ok(spy.log.some(e => e.kind === 'focus' && e.node === ta), 'focus() on the textarea');
      ok(spy.log.every(e => e.kind !== 'focus' || e.preventScroll), 'every focus passes preventScroll');
      const hint = D.getElementById(ta.getAttribute('aria-describedby') || '');
      ok(hint && hero.contains(hint) && isShown(hint), 'hint shown in the card and tied to the textarea (aria-describedby)');
      eq(text(hint).trim(), COPY_HINT, 'hint text');
      ok(hint.getBoundingClientRect().top >= tRect.bottom - 0.5, 'hint under the textarea');
      ok((ta.getAttribute('aria-label') || '').trim().length > 0, 'textarea has an accessible name');
      eq(copy.textContent, COPY_LABEL, 'label does not say Copied');
      await wait(150);
      eq(live.textContent, '', 'live region stays quiet: the hint is already on aria-describedby');

      ta.setSelectionRange(2, 3);
      focusInApp(copy);
      copy.click();
      await wait(150);
      eq(hero.querySelectorAll('textarea').length, 1, 'second failure: still one textarea in the card');
      eq(shownAreas(hero)[0], ta, 'the same textarea');
      eq(ta.value, want, 'same text');
      eq(ta.selectionStart + '–' + ta.selectionEnd, '0–' + want.length, 'all selected again');
      eq(D.activeElement, ta, 'focus back in the textarea');
      eq(said.seen.filter(t => t === COPY_HINT).length, 0, 'hint is not announced: ' + JSON.stringify(said.seen));
      eq(W.scrollY, y, 'still no scroll');
      eq(untouched(), before, 'state, saved state, fields, phase, banner, cards and scroll unchanged');

      // Success while focus is still in the textarea (Safari does not focus a clicked button).
      unfocus();
      unfocus = () => {};
      clip.reply = writeOk;
      copy.click();
      await wait(150);
      ok(!isShown(ta), 'a later success hides the textarea');
      eq(shownAreas(hero).length, 0, 'nothing left open');
      ok(hero.querySelectorAll('textarea').length <= 1, 'no second textarea');
      eq(copy.textContent, COPY_DONE, 'Copied');
      eq(live.textContent, COPY_SAID, 'live region says Copied');
      eq(D.activeElement, copy, 'focus on the button, not lost with the hidden textarea');
      eq(W.scrollY, y, 'no scroll on success either');
      eq(spy.log.filter(e => e.kind === 'scroll').length, 0, 'no scrollIntoView at all');
      ok(spy.log.every(e => e.kind !== 'focus' || e.preventScroll), 'every focus passes preventScroll');
      eq(untouched(), before, 'still unchanged');
      eq(W.QP.app.state.done.length, 0, 'nothing marked done');
    } finally {
      unfocus();
      if (said) said.stop();
      if (spy) spy.restore();
      restore();
      frame.style.height = '';
      instantScroll(false);
    }
  });

  test('Copy for Claude with no navigator.clipboard (or no writeText, or writeText throws): the same read-only textarea, all selected, with the hint; fits at 320px; a repeated click reuses it', async () => {
    instantScroll(true);
    const variants = [
      ['no navigator.clipboard', () => undefined],
      ['clipboard without writeText', () => ({})],
      ['writeText throws', () => ({ writeText() { throw new W.DOMException('Not allowed.', 'NotAllowedError'); } })]
    ];
    try {
      for (const [what, make] of variants) {
        const hero = await heroForCopy();
        const restore = setClipboard(make());
        let unfocus = () => {};
        try {
          frame.style.width = '320px';
          await wait(80);
          const copy = copyBtnOf(hero);
          const want = copyText(projectOf(hero));
          unfocus = focusOnClick(copy);
          focusInApp(copy);
          copy.click();
          await wait(150);
          const areas = shownAreas(hero);
          eq(areas.length, 1, what + ': textarea opens');
          const ta = areas[0];
          ok(ta.readOnly, what + ': read-only');
          eq(ta.value, want, what + ': full text');
          eq(ta.selectionStart + '–' + ta.selectionEnd, '0–' + want.length, what + ': all selected');
          eq(D.activeElement, ta, what + ': focus in the textarea');
          const hint = D.getElementById(ta.getAttribute('aria-describedby') || '');
          ok(hint && isShown(hint) && text(hint).trim() === COPY_HINT, what + ': hint');
          eq(copy.textContent, COPY_LABEL, what + ': label does not say Copied');
          eq(liveOf(hero).textContent, '', what + ': live region stays quiet (hint is on aria-describedby)');
          ok(D.documentElement.scrollWidth <= W.innerWidth + 1, what + ': no horizontal scroll at 320px');
          ok(ta.getBoundingClientRect().right <= hero.getBoundingClientRect().right + 0.5, what + ': textarea inside the card at 320px');
          copy.click();
          await wait(0);
          eq(hero.querySelectorAll('textarea').length, 1, what + ': a repeated click reuses the textarea');
        } finally {
          unfocus();
          restore();
          frame.style.width = '';
        }
      }
    } finally {
      instantScroll(false);
    }
  });


  test('Copy for Claude: at 375 and 1280, .card-actions keeps its height after a successful copy', async () => {
    instantScroll(true);
    const clip = fakeClipboard(writeOk);
    const restore = setClipboard(clip);
    try {
      await heroForCopy();
      for (const width of [375, 1280]) {
        frame.style.width = width + 'px';
        await wait(80);
        const card = cards()[0];
        const row = card.querySelector('.card-actions');
        const copy = copyBtnOf(card);
        eq(copy.textContent, COPY_LABEL, width + 'px: starts as Copy for Claude');
        const before = row.offsetHeight;
        ok(before > 0, width + 'px: .card-actions has a height');
        copy.click();
        await wait(0);
        eq(copy.textContent, COPY_DONE, width + 'px: button says Copied. Go paste.');
        eq(row.offsetHeight, before, width + 'px: .card-actions height unchanged after copy (' + before + ')');
        await wait(150);
        eq(liveOf(card).textContent, COPY_SAID, width + 'px: live region still says Copied. Paste it into Claude.');
        await wait(2100);
        eq(copy.textContent, COPY_LABEL, width + 'px: label reverted');
      }
    } finally {
      restore();
      frame.style.width = '';
      instantScroll(false);
    }
  });

  test('Copy for Claude while the card is re-drawn by a quiz edit: a late clipboard answer, the announcement and the 2s timer touch nothing and throw nothing', async () => {
    instantScroll(true);
    let answer = null;
    const clip = fakeClipboard(() => new W.Promise((resolve, reject) => { answer = { resolve: resolve, reject: reject }; }));
    const restore = setClipboard(clip);
    const rejections = [];
    const onRejection = e => rejections.push(String(e.reason));
    const errorsBefore = appErrors.length;
    let watched = null;
    try {
      await heroForCopy();
      watched = W;
      W.addEventListener('unhandledrejection', onRejection);
      const redraw = () => setVal('q-other', ''); // a quiz edit: renderRecs draws the same cards anew
      for (const outcome of ['resolve', 'reject']) {
        const old = cards()[0];
        copyBtnOf(old).click();
        ok(answer, outcome + ': write pending');
        redraw();
        const now = cards()[0];
        ok(now !== old && !old.isConnected, outcome + ': card re-drawn while the write is pending');
        eq(now.dataset.id, old.dataset.id, outcome + ': same project');
        if (outcome === 'resolve') answer.resolve();
        else answer.reject(new W.DOMException('Write permission denied.', 'NotAllowedError'));
        answer = null;
        await wait(200);
        eq(copyBtnOf(old).textContent, COPY_LABEL, outcome + ': the old, detached button is left alone');
        eq(old.querySelectorAll('textarea').length, 0, outcome + ': no textarea built in the old card');
        eq(liveOf(old).textContent, '', outcome + ': old live region untouched');
        eq(copyBtnOf(now).textContent, COPY_LABEL, outcome + ': the new card starts fresh');
        eq(shownAreas(now).length, 0, outcome + ': no textarea in the new card');
        eq(liveOf(now).textContent, '', outcome + ': new live region quiet');
      }
      // Copied: the announcement and the 2s timer are still pending when the card is re-drawn.
      clip.reply = writeOk;
      const old = cards()[0];
      copyBtnOf(old).click();
      await wait(0);
      eq(copyBtnOf(old).textContent, COPY_DONE, 'Copied');
      redraw();
      const now = cards()[0];
      ok(!old.isConnected, 're-drawn inside the 2s');
      await wait(2200);
      eq(copyBtnOf(now).textContent, COPY_LABEL, 'the new card is not touched by the old timer');
      eq(liveOf(now).textContent, '', 'the new live region stays quiet');
      // Failed: the textarea is open when the card is re-drawn, and goes with the old card.
      clip.reply = writeDenied;
      copyBtnOf(now).click();
      await wait(150);
      eq(shownAreas(now).length, 1, 'textarea open');
      redraw();
      await wait(150);
      eq(Array.from(D.querySelectorAll('textarea')).filter(isShown).length, 0, 'no textarea left on the page');
      eq(copyBtnOf(cards()[0]).textContent, COPY_LABEL, 're-drawn card starts fresh');
      eq(appErrors.length, errorsBefore, 'no page errors: ' + appErrors.slice(errorsBefore).join(' / '));
      eq(rejections.length, 0, 'no unhandled promise rejections: ' + rejections.join(' / '));
    } finally {
      if (watched) watched.removeEventListener('unhandledrejection', onRejection);
      restore();
      instantScroll(false);
    }
  });

  // The same fallback showFallback builds for a rejected write: one read-only textarea, all of
  // the text selected, the ⌘C / Ctrl+C hint, focus there, and a quiet live region.
  // focused: the element that had focus in the same turn the box opened. Headless virtual time
  // can move focus again before this check runs, so pass that element when the open was async.
  function expectCopyFallback(hero, want, what, focused) {
    const areas = shownAreas(hero);
    eq(areas.length, 1, what + ': one textarea');
    const ta = areas[0];
    ok(ta.readOnly, what + ': read-only');
    eq(ta.value, want, what + ': full text');
    eq(ta.selectionStart + '–' + ta.selectionEnd, '0–' + want.length, what + ': all selected');
    eq(focused == null ? D.activeElement : focused, ta, what + ': focus in the textarea');
    const hint = D.getElementById(ta.getAttribute('aria-describedby') || '');
    ok(hint && hero.contains(hint) && isShown(hint) && text(hint).trim() === COPY_HINT, what + ': hint');
    eq(copyBtnOf(hero).textContent, COPY_LABEL, what + ': label does not say Copied');
    eq(liveOf(hero).textContent, '', what + ': live region stays quiet');
  }

  test('Copy for Claude when writeText resolves: label says Copied at once, still Copied after 1s, and no fallback opens (the write timer is cleared)', async () => {
    instantScroll(true);
    const clip = fakeClipboard(writeOk);
    const restore = setClipboard(clip);
    const realSet = W.setTimeout;
    const realClear = W.clearTimeout;
    const armed = [];
    const cleared = [];
    let spying = false;
    try {
      const hero = await heroForCopy();
      const copy = copyBtnOf(hero);
      // The settled flag would hide a timer that was left running, so watch clearTimeout itself.
      W.setTimeout = function (fn, ms) {
        const id = realSet.apply(W, arguments);
        if (ms === 1000) armed.push(id);
        return id;
      };
      W.clearTimeout = function (id) {
        cleared.push(id);
        return realClear.call(W, id);
      };
      spying = true;
      copy.click();
      await wait(0);
      eq(clip.writes.length, 1, 'one write');
      eq(copy.textContent, COPY_DONE, 'Copied as soon as the write resolves');
      eq(shownAreas(hero).length, 0, 'no textarea');
      eq(armed.length, 1, 'one 1s write timer');
      ok(cleared.indexOf(armed[0]) !== -1, 'clearTimeout was called with that timer');
      await wait(1200);
      eq(copy.textContent, COPY_DONE, 'still Copied 1.2s later: the 1s write timer did not open the fallback');
      eq(shownAreas(hero).length, 0, 'still no textarea');
      eq(liveOf(hero).textContent, COPY_SAID, 'live region still says Copied');
    } finally {
      if (spying) {
        W.setTimeout = realSet;
        W.clearTimeout = realClear;
      }
      restore();
      instantScroll(false);
    }
  });

  test('Copy for Claude when writeText never settles: still waiting at 200ms; the same read-only fallback as a rejected write is up within 1.5s', async () => {
    instantScroll(true);
    const clip = fakeClipboard(() => new W.Promise(() => {}));
    const restore = setClipboard(clip);
    try {
      const hero = await heroForCopy();
      const copy = copyBtnOf(hero);
      const want = copyText(projectOf(hero));
      let atFire = null;
      const undo = atWriteTimeout(fn => {
        focusInApp(copy);
        fn();
        atFire = D.activeElement;
      });
      try {
        focusInApp(copy);
        copy.click();
        await wait(0);
        eq(clip.writes.length, 1, 'tried the clipboard');
        eq(clip.writes[0], want, 'with the full text');
        await wait(200);
        eq(shownAreas(hero).length, 0, 'no textarea yet: a hang is not an instant failure');
        eq(copy.textContent, COPY_LABEL, 'label unchanged while the write is pending');
        eq(liveOf(hero).textContent, '', 'live region quiet while pending');
        await wait(1300);
        expectCopyFallback(hero, want, 'within 1.5s', atFire);
      } finally {
        undo();
      }
    } finally {
      restore();
      instantScroll(false);
    }
  });

  test('Copy for Claude when the fallback opens: focus moves into the box if it is still on the button or the body, and stays put if it moved elsewhere during the write', async () => {
    instantScroll(true);
    const clip = fakeClipboard(() => new W.Promise(() => {}));
    const restore = setClipboard(clip);
    try {
      const hero = await heroForCopy();
      const copy = copyBtnOf(hero);
      const elsewhere = hero.querySelector('.done-btn');
      const want = copyText(projectOf(hero));
      // .click() does not focus. A real click does. Re-apply the focus inside the 1s timer,
      // in the same turn showFallback reads it: virtual time can drop it during the wait.
      let place = 'away';
      let atFire = null;
      const undo = atWriteTimeout(fn => {
        if (place === 'away') focusInApp(elsewhere);
        else if (place === 'button') focusInApp(copy);
        else {
          W.focus();
          const cur = W.document.activeElement;
          if (cur && cur !== W.document.body && cur.blur) cur.blur();
        }
        fn();
        atFire = D.activeElement;
      });
      try {
        focusInApp(copy);
        copy.click();
        eq(D.activeElement, copy, 'focus is on the button while the write is pending');
        focusInApp(elsewhere);
        eq(D.activeElement, elsewhere, 'focus moved to Mark done before the timeout');
        await wait(1500);
        const areas = shownAreas(hero);
        eq(areas.length, 1, 'the fallback box opened');
        eq(areas[0].value, want, 'the box holds the project text');
        eq(areas[0].selectionStart + '–' + areas[0].selectionEnd, '0–' + want.length, 'all of it selected');
        eq(atFire, elsewhere, 'focus stays on Mark done: the box does not take it');

        place = 'button';
        focusInApp(copy);
        copy.click();
        eq(D.activeElement, copy, 'focus is on the button while the next write is pending');
        await wait(1500);
        eq(shownAreas(hero).length, 1, 'still the one box');
        eq(atFire, areas[0], 'focus moves from the button into the box');

        place = 'body';
        focusInApp(copy);
        copy.click();
        W.focus();
        copy.blur();
        eq(D.activeElement, D.body, 'focus is on the body while the next write is pending');
        await wait(1500);
        eq(atFire, areas[0], 'focus moves from the body into the box');
      } finally {
        undo();
      }
    } finally {
      restore();
      instantScroll(false);
    }
  });

  test('Copy for Claude when writeText resolves after the 1s timeout: the fallback stays, and the label never flashes Copied', async () => {
    instantScroll(true);
    let release = null;
    const clip = fakeClipboard(() => new W.Promise(resolve => { release = resolve; }));
    const restore = setClipboard(clip);
    let label = null;
    let said = null;
    try {
      const hero = await heroForCopy();
      const copy = copyBtnOf(hero);
      const live = liveOf(hero);
      const want = copyText(projectOf(hero));
      let atFire = null;
      const undo = atWriteTimeout(fn => {
        focusInApp(copy);
        fn();
        atFire = D.activeElement;
      });
      try {
        focusInApp(copy);
        copy.click();
        await wait(1500);
        expectCopyFallback(hero, want, 'before the late resolve', atFire);
        label = watchText(copy);
        said = watchText(live);
        ok(typeof release === 'function', 'the write is still pending');
        release();
        await wait(400);
        eq(copy.textContent, COPY_LABEL, 'late resolve does not say Copied');
        expectCopyFallback(hero, want, 'after the late resolve', atFire);
        ok(label.seen.indexOf(COPY_DONE) === -1, 'label never flashes Copied: ' + JSON.stringify(label.seen));
        ok(said.seen.indexOf(COPY_SAID) === -1, 'live region never says Copied: ' + JSON.stringify(said.seen));
      } finally {
        undo();
      }
    } finally {
      if (label) label.stop();
      if (said) said.stop();
      restore();
      instantScroll(false);
    }
  });

  // ---------------- Not this one (#33) ----------------

  const NOT_THIS = 'Not this one';
  const PICKS_OUT = "That’s every pick that fits this quota. Change your answers or come back after the reset.";
  const NEW_PICK = 'New pick: ';
  const notBtn = () => $('not-this-btn');
  const outLine = () => D.querySelector('#recs-list .pick-out');
  const idsIn = band => W.QP.PROJECTS.filter(p => p.band === band).map(p => p.id);
  const titleOf = c => text(c.querySelector('h3'));

  // What a screen reader would get from the app's live regions (aria-live, or role status /
  // alert / log) while this watches: after each batch of DOM changes, the text of every region
  // that changed, if it has any. Emptying a region is not a line; filling it again is.
  function watchLive() {
    const heard = [];
    function regionOf(node) {
      for (let n = node && node.nodeType === 1 ? node : node && node.parentElement; n; n = n.parentElement) {
        const live = n.getAttribute('aria-live');
        if (live && live !== 'off') return n;
        if (/^(status|alert|log)$/.test(n.getAttribute('role') || '')) return n;
      }
      return null;
    }
    const mo = new W.MutationObserver(list => {
      const touched = [];
      list.forEach(m => {
        const r = regionOf(m.target);
        if (r && touched.indexOf(r) === -1) touched.push(r);
      });
      touched.forEach(r => {
        const t = r.textContent.trim();
        if (t) heard.push(t);
      });
    });
    mo.observe(D.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    return { lines: () => heard.slice(), stop: () => mo.disconnect() };
  }

  // Logs window.scrollTo / scrollBy / scroll calls in the app iframe (spyScrollFocus covers
  // scrollIntoView and focus). Returns { calls, restore }.
  function spyWindowScroll() {
    const calls = [];
    const real = {};
    ['scrollTo', 'scrollBy', 'scroll'].forEach(k => {
      real[k] = W[k];
      W[k] = function () {
        calls.push(k);
        return real[k].apply(W, arguments);
      };
    });
    const win = W;
    return { calls: calls, restore: () => Object.keys(real).forEach(k => { win[k] = real[k]; }) };
  }

  test('Not this one: a small text button under the one card, only while a card shows; each click swaps in the next project of the same band (catalog order with no preferences), still one card, More projects never repeats it, nothing marked done; when the band runs out the card area says exactly so and the button is disabled', async () => {
    instantScroll(true);
    try {
      await fresh();
      const btn = notBtn();
      ok(btn, 'Not this one is on the page');
      ok(!isShown(btn), 'first visit: no Not this one');
      $('example-btn').click();
      ok(!isShown(btn), 'numbers in, before Get project: no Not this one');
      fill('claude', { s: 85, w: 30 }); // 15% left: Small
      calc();
      eq(resultOf('claude').dataset.band, 'small', 'Small band');
      const order = idsIn('small');
      const hero = cards()[0];
      eq(hero.dataset.id, order[0], 'the first pick is the first Small project');
      ok(isShown(btn), 'Not this one shows with the card');
      eq(btn.textContent, NOT_THIS, 'label');
      eq(btn.tagName + ' type=' + btn.getAttribute('type'), 'BUTTON type=button', 'native button');
      ok(!$('recs-list').contains(btn), 'outside the card area, so the card area holds only the card');
      ok(!btn.classList.contains('primary') && !btn.classList.contains('secondary') && !btn.classList.contains('done-btn'), 'not another CTA: ' + btn.className);
      const bs = W.getComputedStyle(btn);
      const ds = W.getComputedStyle(hero.querySelector('.done-btn'));
      const enabledColor = bs.color;
      eq(bs.backgroundColor, 'rgba(0, 0, 0, 0)', 'a text button: no fill');
      eq(parseFloat(bs.borderTopWidth) + parseFloat(bs.borderBottomWidth), 0, 'a text button: no border');
      ok(parseFloat(bs.fontSize) < parseFloat(ds.fontSize), 'small: smaller text than Mark done (' + bs.fontSize + ' vs ' + ds.fontSize + ')');
      for (const width of [320, 375, 1280]) {
        frame.style.width = width + 'px';
        await wait(80);
        const c = cards()[0].getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        ok(b.top >= c.bottom - 0.5, width + 'px: under the card');
        ok(b.left >= c.left - 0.5 && b.right <= c.right + 0.5, width + 'px: within the card\'s width');
        const label = D.createRange();
        label.selectNodeContents(btn);
        eq(label.getClientRects().length, 1, width + 'px: label on one line');
        ok(b.height >= 43.5, width + 'px: still a 44px touch target (' + b.height + ')');
        ok(D.documentElement.scrollWidth <= W.innerWidth + 1, width + 'px: no horizontal scroll');
      }
      frame.style.width = '';
      await wait(80);

      for (let i = 1; i < order.length; i++) {
        btn.click();
        eq(cards().length, 1, 'skip ' + i + ': one card');
        eq(Array.from(D.querySelectorAll('.card')).filter(isShown).length, 1, 'skip ' + i + ': no second card on screen');
        const now = cards()[0];
        eq(now.dataset.id, order[i], 'skip ' + i + ': the next project of the band');
        eq(now.dataset.band, 'small', 'skip ' + i + ': same band');
        ok(now.classList.contains('hero'), 'skip ' + i + ': it is the hero');
        ok(isShown(btn), 'skip ' + i + ': Not this one still there');
        ok(!moreCards().some(c => c.dataset.id === now.dataset.id), 'skip ' + i + ': More projects does not repeat the pick');
        eq(cards().length + moreCards().length, bandCount('small'), 'skip ' + i + ': More projects lists every other project');
      }
      btn.click();
      eq(cards().length, 0, 'band ran out: no card');
      eq(text($('recs-list')), PICKS_OUT, 'the card area says exactly the line');
      ok(isShown(outLine()), 'the line is on screen');
      eq(btn.getAttribute('aria-disabled'), 'true', 'band ran out: Not this one is disabled');
      ok(isShown(btn) && !btn.disabled, 'it stays in place (aria-disabled, not disabled), so focus on it is not dropped');
      ok(W.getComputedStyle(btn).color !== enabledColor, 'and looks muted');
      eq(W.QP.app.state.done.length, 0, 'skipping marks nothing done');
      ok($('done-banner').hidden, 'no done banner');
      eq(D.querySelector('main').dataset.phase, 'project', 'still the project page');
      eq(moreCards().length, bandCount('small'), 'More projects still lists the band');
      const skipsAtOut = W.QP.app.state.skipped.join();
      btn.click();
      eq(text($('recs-list')), PICKS_OUT, 'a click on the disabled button changes nothing');
      eq(W.QP.app.state.skipped.join(), skipsAtOut, 'not even the skip list');

      calc();
      ok(cards().length === 1 && isShown(btn) && !btn.hasAttribute('aria-disabled'), 'Get project again: a card, and Not this one works again');
      cards()[0].querySelector('.done-btn').click();
      ok(!isShown(btn), 'after Mark done: no Not this one');
      fill('claude', { s: 100, w: 50 });
      calc();
      eq(resultOf('claude').dataset.band, 'none', 'nothing left');
      ok(!isShown(btn), 'nothing left: no Not this one');
      fill('claude', { s: 150, w: 30 });
      calc();
      ok(!isShown(btn) && cards().length === 0, 'wrong numbers: no card, no Not this one');
    } finally {
      frame.style.width = '';
      instantScroll(false);
    }
  });

  test('Not this one: with no preferences the status line says picks go in list order, which stays true after a swap, once the band runs out, and on a redraw (it never claims the first project)', async () => {
    instantScroll(true);
    try {
      await fresh();
      fill('claude', { s: 85, w: 30 }); // Small
      calc();
      const line = 'No preferences yet. Picks go in list order.';
      ok(statusText().indexOf(line) !== -1, 'after Get project: ' + statusText());
      notBtn().click();
      ok(statusText().indexOf(line) !== -1 && statusText().indexOf('first project') === -1, 'after a swap: ' + statusText());
      for (let i = 0; i < 20 && !outLine(); i++) notBtn().click();
      eq(text($('recs-list')), PICKS_OUT, 'band ran out');
      ok(statusText().indexOf('first project') === -1, 'band ran out: ' + statusText());
      setVal('q-other', ''); // a redraw with every pick skipped
      ok(statusText().indexOf(line) !== -1 && statusText().indexOf('first project') === -1, 'redrawn: ' + statusText());
    } finally {
      instantScroll(false);
    }
  });

  test('Not this one does not scroll (reduced motion on or off) and keeps focus on the button; screen readers hear one line, "New pick: <title>", and the status lines under the card stay as they are', async () => {
    for (const reduce of [false, true]) {
      const tag = (reduce ? 'reduce' : 'no-preference') + ': ';
      let undo = () => {};
      let spy = null;
      let win = null;
      let live = null;
      try {
        await fresh();
        frame.style.height = '600px';
        instantScroll(true);
        fill('claude', { s: 72, h: 3, m: 12, w: 31 }); // Medium
        calc();
        await wait(0);
        W.scrollTo(0, 150);
        await wait(50);
        instantScroll(false);
        undo = mockReducedMotion(() => reduce);
        const y = W.scrollY;
        eq(y, 150, tag + 'page parked at 150');
        const btn = notBtn();
        focusInApp(btn); // a real click focuses the button; .click() does not
        const old = cards()[0];
        const status = $('recs-status');
        const statusNodes = Array.from(status.childNodes);
        const statusHTML = status.innerHTML;
        ok(statusNodes.length > 0, tag + 'status lines are showing');
        spy = spyScrollFocus();
        win = spyWindowScroll();
        live = watchLive();

        btn.click();
        const now = cards()[0];
        ok(now && now !== old && !old.isConnected, tag + 'the card was swapped');
        eq(D.activeElement, btn, tag + 'focus stays on Not this one');
        await wait(150);
        eq(W.scrollY, y, tag + 'the page did not scroll');
        eq(spy.log.filter(e => e.kind === 'scroll').length, 0, tag + 'no scrollIntoView');
        eq(win.calls.length, 0, tag + 'no scrollTo / scrollBy / scroll: ' + win.calls.join());
        eq(spy.log.filter(e => e.kind === 'focus').length, 0, tag + 'nothing called focus(): ' + spy.log.map(e => e.kind + ' ' + nodeName(e.node)).join(', '));
        eq(text($('pick-live')), NEW_PICK + titleOf(now), tag + 'the live region says the new title');
        eq(live.lines().join(' | '), NEW_PICK + titleOf(now), tag + 'one line heard');
        eq(status.innerHTML, statusHTML, tag + 'status lines unchanged');
        ok(statusNodes.every(n => n.parentNode === status) && status.childNodes.length === statusNodes.length, tag + 'the same status nodes, so none is read again');

        btn.click();
        const third = cards()[0];
        eq(D.activeElement, btn, tag + 'second swap: focus still on Not this one');
        await wait(150);
        eq(live.lines().join(' | '), NEW_PICK + titleOf(now) + ' | ' + NEW_PICK + titleOf(third), tag + 'second swap: one more line, with its own title');
        eq(W.scrollY, y, tag + 'second swap: still no scroll');
        eq(spy.log.filter(e => e.kind === 'scroll').length + win.calls.length, 0, tag + 'second swap: no scroll calls');
      } finally {
        if (live) live.stop();
        if (win) win.restore();
        if (spy) spy.restore();
        undo();
        instantScroll(false);
        frame.style.height = '';
      }
    }
  });

  test('Not this one: a full redraw before the New pick line is read drops it, so screen readers never hear a title the card no longer shows', async () => {
    let live = null;
    try {
      await fresh();
      fill('claude', { s: 72, h: 3, m: 12, w: 31 }); // Medium
      calc();
      await wait(0);
      live = watchLive();
      notBtn().click(); // queues "New pick: <title>" SAY_MS later
      calc(); // Get project redraws the card before that line is read
      await wait(150);
      eq(text($('pick-live')), '', 'the live region is empty after the redraw');
      eq(live.lines().filter(l => l.indexOf(NEW_PICK) === 0).length, 0, 'no New pick line was heard: ' + live.lines().join(' | '));
    } finally {
      if (live) live.stop();
    }
  });

  test('Not this one, band ran out: focus stays on the button, now aria-disabled, and the page stays put even parked at the very bottom (a shorter card area would pull it up); the live region says the line once; focus elsewhere stays put too; writing what you want brings a pick back', async () => {
    instantScroll(true);
    frame.style.height = '600px';
    let spy = null;
    let live = null;
    try {
      await fresh();
      fill('claude', { s: 85, w: 30 }); // Small
      calc();
      const btn = notBtn();
      const order = idsIn('small');
      const toLast = () => { for (let i = 1; i < order.length; i++) btn.click(); };
      toLast();
      eq(cards()[0].dataset.id, order[order.length - 1], 'the last pick of the band');
      await wait(150);
      W.scrollTo(0, D.documentElement.scrollHeight);
      await wait(50);
      const y = W.scrollY;
      ok(y > 0 && Math.abs(y - (D.documentElement.scrollHeight - W.innerHeight)) <= 1, 'parked at the bottom (' + y + ')');
      const region = () => $('recs-list').offsetHeight + $('not-this-row').offsetHeight;
      const before = region();
      focusInApp(btn);
      spy = spyScrollFocus();
      live = watchLive();
      btn.click();
      const line = outLine();
      ok(line && isShown(line), 'the line is in the card area');
      eq(text(line), PICKS_OUT, 'exact line');
      ok(!line.hasAttribute('tabindex'), 'the line is text, not a focus target');
      eq(D.activeElement, btn, 'focus stays on Not this one');
      eq(btn.getAttribute('aria-disabled'), 'true', 'which is now aria-disabled');
      ok(region() >= before - 0.5, 'the card region did not get shorter (' + before + ' → ' + region() + ')');
      await wait(150);
      eq(W.scrollY, y, 'no scroll, even at the bottom of the page');
      eq(spy.log.length, 0, 'no scrollIntoView or focus calls: ' + spy.log.map(e => e.kind + ' ' + nodeName(e.node)).join(', '));
      eq(live.lines().join(' | '), PICKS_OUT, 'one line heard: the out line');
      eq(text($('pick-live')), PICKS_OUT, 'the live region holds it');
      live.stop();
      spy.restore();
      spy = null;

      calc();
      eq(cards()[0].dataset.id, order[0], 'Get project again starts the band over');
      ok(!btn.hasAttribute('aria-disabled'), 'and Not this one works again');
      eq($('recs-list').style.minHeight, '', 'a full redraw lets the card area take its own height');
      toLast();
      await wait(150);
      focusInApp($('calc-btn')); // Safari leaves a click's focus where it was
      live = watchLive();
      btn.click();
      eq(text(outLine()), PICKS_OUT, 'the line again');
      eq(D.activeElement, $('calc-btn'), 'focus that was elsewhere stays there');
      await wait(150);
      eq(live.lines().join(' | '), PICKS_OUT, 'the live region says the line once');
      live.stop();

      setVal('q-wish', 'organize the closet');
      eq(cards().length, 1, 'writing what you want adds a pick');
      eq(cards()[0].dataset.id, 'custom:organize the closet', 'the card built from what you wrote');
      eq(cards()[0].dataset.band, 'small', 'in the same band');
      ok(isShown(btn) && !btn.hasAttribute('aria-disabled') && !outLine(), 'Not this one works again and the line is gone');
    } finally {
      if (live) live.stop();
      if (spy) spy.restore();
      frame.style.height = '';
      instantScroll(false);
    }
  });

  test('Not this one: a swap to another pick takes the new card\'s own height, so opening Show steps and swapping leaves no empty space under the card', async () => {
    try {
      await fresh();
      frame.style.width = '375px';
      await wait(80);
      fill('claude', { s: 85, w: 30 }); // Small
      calc();
      const btn = notBtn();
      const steps = cards()[0].querySelector('details.steps');
      steps.open = true;
      await wait(0);
      const tall = $('recs-list').offsetHeight;
      btn.click();
      const now = cards()[0];
      ok(!now.querySelector('details.steps').open, 'the new card starts with its steps closed');
      eq($('recs-list').style.minHeight, '', 'no height lock on a swap to another pick');
      ok($('recs-list').offsetHeight < tall, 'the card area got shorter (' + tall + ' → ' + $('recs-list').offsetHeight + ')');
      const gap = $('recs-list').getBoundingClientRect().bottom - now.getBoundingClientRect().bottom;
      ok(gap <= 1, 'no blank space under the card (' + gap + 'px)');
    } finally {
      frame.style.width = '';
      await wait(80);
    }
  });

  test('Not this one, band ran out: a wider window lets go of the height lock, so no blank space stays under the line; a height-only resize (a phone\'s address bar) keeps it', async () => {
    try {
      await fresh();
      frame.style.width = '320px';
      await wait(80);
      fill('claude', { s: 85, w: 30 }); // Small
      calc();
      const btn = notBtn();
      const order = idsIn('small');
      for (let i = 1; i < order.length; i++) btn.click();
      cards()[0].querySelector('details.steps').open = true; // a tall last card
      await wait(0);
      btn.click();
      ok(outLine(), 'the band ran out');
      ok($('recs-list').style.minHeight !== '', 'the card area holds its height at 320px');
      frame.style.height = (frame.offsetHeight - 60) + 'px';
      await wait(80);
      W.dispatchEvent(new W.Event('resize'));
      ok($('recs-list').style.minHeight !== '', 'a height-only resize keeps the lock');
      frame.style.width = '1280px';
      await wait(80);
      W.dispatchEvent(new W.Event('resize')); // virtual time runs no rendering steps, so the browser's own resize event never comes
      eq($('recs-list').style.minHeight, '', 'a wider window drops the lock');
      const line = outLine().getBoundingClientRect();
      const area = $('recs-list').getBoundingClientRect();
      ok(area.bottom - line.bottom <= 1, 'no blank space under the line (' + (area.bottom - line.bottom) + 'px)');
      ok(line.height < 200, 'the line takes its own height (' + line.height + 'px)');
      eq(text(outLine()), PICKS_OUT, 'the line is still there');
    } finally {
      frame.style.width = '';
      frame.style.height = '';
      await wait(80);
    }
  });

  test('Not this one: Copy for Claude and Mark done act on the card that is showing after the swap', async () => {
    instantScroll(true);
    const clip = fakeClipboard(writeOk);
    const restore = setClipboard(clip);
    try {
      const first = await heroForCopy(); // Medium
      const firstP = projectOf(first);
      notBtn().click();
      const now = cards()[0];
      const p = projectOf(now);
      ok(p && p.id !== firstP.id && p.band === firstP.band, 'swapped to another project of the band: ' + now.dataset.id);
      copyBtnOf(now).click();
      await wait(0);
      eq(clip.writes.length, 1, 'one write');
      eq(clip.writes[0], copyText(p), 'Copy writes the swapped project');
      ok(clip.writes[0] !== copyText(firstP), 'not the first pick');
      eq(copyBtnOf(now).textContent, COPY_DONE, 'the swapped card says Copied');
      await wait(150);
      eq(liveOf(now).textContent, COPY_SAID, 'its live region says Copied');
      eq(W.QP.app.state.done.length, 0, 'copying marks nothing done');
      now.querySelector('.done-btn').click();
      eq(W.QP.app.state.done.join(), p.id, 'Mark done marks the swapped project, not the first pick');
      eq(W.QP.app.state.doneTitles.join(), p.title, 'with its title');
      ok(!$('done-banner').hidden && cards().length === 0, 'done banner; no card until Fill again');
      ok(!isShown(notBtn()), 'no Not this one in the done state');
      eq(D.activeElement, $('recalc-btn'), 'focus on Fill again');
    } finally {
      restore();
      instantScroll(false);
    }
  });

  test('Not this one: skips stay for this tab (saved with the preferences in qp-v0, nothing else stored) through quiz edits and a plain Fill; Get project again and Fill again start the band over; Clear forgets them', async () => {
    const usage = fixtureUsage();
    const saved = () => JSON.parse(W.sessionStorage.getItem('qp-v0'));
    instantScroll(true);
    try {
      await fresh();
      installUsageBridge(() => ({ ok: true, usage: usage }));
      $('fill-usage-btn').click();
      await flushFill();
      calc();
      eq(resultOf('claude').dataset.band, 'medium', 'the Usage fixture is Medium');
      const order = idsIn('medium');
      eq(cards()[0].dataset.id, order[0], 'first pick');
      notBtn().click();
      notBtn().click();
      eq(cards()[0].dataset.id, order[2], 'two skips');
      eq(saved().skipped.join(), order.slice(0, 2).join(), 'skips saved with the preferences');
      eq(W.sessionStorage.length, 1, 'one sessionStorage entry, as before');
      eq(W.localStorage.length, 0, 'nothing in localStorage');
      eq(D.cookie, '', 'no cookie');
      eq(W.location.search + W.location.hash, '', 'nothing in the address');

      setVal('q-other', '');
      eq(cards()[0].dataset.id, order[2], 'a quiz edit redraws the card area and keeps the skips');
      pick('input[name="q-domain"][value="work"]');
      eq(W.QP.PROJECTS.find(p => p.id === order[0]).domain + ',' + W.QP.PROJECTS.find(p => p.id === order[1]).domain, 'work,work', 'both skipped projects are Work');
      eq(cards()[0].dataset.id, order[2], 'with Work picked, the skipped Work projects stay skipped: the next pick is the best of the rest');
      unpick('input[name="q-domain"][value="work"]');

      $('fill-usage-btn').click();
      await flushFill();
      eq($('fill-status').textContent, FILL_AGAIN, 'a second Fill read');
      eq(cards()[0].dataset.id, order[2], 'a plain Fill only copies numbers: same card, skips kept');
      eq(saved().skipped.join(), order.slice(0, 2).join(), 'skips still saved');

      calc();
      eq(cards()[0].dataset.id, order[0], 'Get project again starts the band over');
      eq(saved().skipped.length, 0, 'saved skips emptied');

      notBtn().click();
      eq(cards()[0].dataset.id, order[1], 'skip once more');
      cards()[0].querySelector('.done-btn').click();
      eq(W.QP.app.state.skipped.join(), order[0], 'Mark done keeps the skip list');
      $('recalc-btn').click();
      eq(W.QP.app.state.skipped.length, 0, 'Fill again empties the skip list');
      eq(saved().skipped.length, 0, 'and the saved one');
      await flushFill();
      calc();
      eq(cards()[0].dataset.id, order[0], 'after Fill again: the first pick again (the done one stays hidden)');

      notBtn().click();
      removeUsageBridge();
      await reloadApp();
      eq(W.QP.app.state.skipped.join(), order[0], 'a reload in the same tab brings the skips back with the preferences');
      calc();
      eq(cards()[0].dataset.id, order[0], 'and Get project still starts the band over');
      notBtn().click();
      eq(saved().skipped.join(), order[0], 'skip saved');
      $('clear-btn').click();
      eq(W.QP.app.state.skipped.length, 0, 'Clear forgets the skips');
      eq(W.sessionStorage.getItem('qp-v0'), null, 'nothing saved');
    } finally {
      removeUsageBridge();
      instantScroll(false);
    }
  });

  test('Not this one with focus inside the old card (Safari leaves a click\'s focus where it was, e.g. in the manual-copy box): focus moves to Not this one without scrolling, and the one line read is still New pick', async () => {
    instantScroll(true);
    const clip = fakeClipboard(writeDenied);
    const restore = setClipboard(clip);
    let spy = null;
    let live = null;
    let unfocus = () => {};
    try {
      const hero = await heroForCopy();
      const copy = copyBtnOf(hero);
      W.scrollTo(0, 150);
      await wait(50);
      const y = W.scrollY;
      focusInApp(copy);
      unfocus = focusOnClick(copy);
      copy.click();
      await wait(0);
      unfocus();
      unfocus = () => {};
      const ta = shownAreas(hero)[0];
      ok(ta, 'the manual-copy box is open in the card');
      eq(D.activeElement, ta, 'focus is in the box');
      spy = spyScrollFocus();
      live = watchLive();
      notBtn().click(); // like Safari: the click leaves focus in the box
      const now = cards()[0];
      ok(!hero.isConnected && now !== hero, 'the card was swapped');
      eq(D.activeElement, notBtn(), 'focus moved to Not this one, not lost to the page');
      ok(spy.log.some(e => e.kind === 'focus' && e.node === notBtn() && e.preventScroll), 'focus() with preventScroll');
      await wait(150);
      eq(spy.log.filter(e => e.kind === 'scroll').length, 0, 'no scrollIntoView');
      eq(W.scrollY, y, 'no scroll');
      eq(live.lines().join(' | '), NEW_PICK + titleOf(now), 'one line: New pick');
      eq(shownAreas(now).length, 0, 'the new card starts with no box');
    } finally {
      unfocus();
      if (live) live.stop();
      if (spy) spy.restore();
      restore();
      instantScroll(false);
    }
  });

  test('Not this one while Copy for Claude is still writing: a late answer and the 1s write timer leave both cards alone and never take focus from Not this one', async () => {
    instantScroll(true);
    let answer = null;
    const clip = fakeClipboard(() => new W.Promise((resolve, reject) => { answer = { resolve: resolve, reject: reject }; }));
    const restore = setClipboard(clip);
    const errorsBefore = appErrors.length;
    let spy = null;
    try {
      await heroForCopy();
      for (const outcome of ['resolve', 'reject']) {
        const old = cards()[0];
        copyBtnOf(old).click();
        ok(answer, outcome + ': write pending');
        focusInApp(notBtn());
        notBtn().click();
        const now = cards()[0];
        ok(!old.isConnected && now !== old, outcome + ': swapped while the write is pending');
        eq(D.activeElement, notBtn(), outcome + ': focus on Not this one');
        spy = spyScrollFocus();
        if (outcome === 'resolve') answer.resolve();
        else answer.reject(new W.DOMException('Write permission denied.', 'NotAllowedError'));
        answer = null;
        await wait(200);
        eq(copyBtnOf(old).textContent, COPY_LABEL, outcome + ': the old, detached button is left alone');
        eq(old.querySelectorAll('textarea').length, 0, outcome + ': no box built in the old card');
        eq(copyBtnOf(now).textContent, COPY_LABEL, outcome + ': the new card is untouched');
        eq(shownAreas(now).length, 0, outcome + ': no box in the new card');
        eq(liveOf(now).textContent, '', outcome + ': the new card\'s live region is quiet');
        eq(spy.log.length, 0, outcome + ': no focus or scroll calls: ' + spy.log.map(e => e.kind + ' ' + nodeName(e.node)).join(', '));
        spy.restore();
        spy = null;
      }
      // A write that never settles: the 1s timer fires for a card that is gone.
      clip.reply = () => new W.Promise(() => {});
      let atFire = null;
      const undo = atWriteTimeout(fn => {
        focusInApp(notBtn());
        fn();
        atFire = D.activeElement;
      });
      try {
        const old = cards()[0];
        copyBtnOf(old).click();
        focusInApp(notBtn());
        notBtn().click();
        const now = cards()[0];
        ok(!old.isConnected, 'swapped while the write hangs');
        await wait(1500);
        eq(atFire, notBtn(), 'when the 1s timer fired, focus stayed on Not this one');
        eq(Array.from(D.querySelectorAll('textarea')).filter(isShown).length, 0, 'no manual-copy box anywhere');
        eq(copyBtnOf(now).textContent, COPY_LABEL, 'the new card is untouched');
      } finally {
        undo();
      }
      eq(appErrors.length, errorsBefore, 'no page errors: ' + appErrors.slice(errorsBefore).join(' / '));
    } finally {
      if (spy) spy.restore();
      restore();
      instantScroll(false);
    }
  });

  // 「真发一个请求看会不会被拦下」放在 tests/probe.html 里单独跑：被拦下时浏览器一定会在控制台打一条提示，
  // 放在这里会让这套测试的控制台不干净。
  test('不联网：整个流程走完，只加载过本地的 css/js，页面里没有外部地址，也没有表单能提交出去', async () => {
    const origin = W.location.origin;
    const res = W.performance.getEntriesByType('resource').map(e => e.name);
    ok(res.length >= 4, '加载了本地文件');
    res.forEach(u => ok(u.indexOf(origin) === 0 && /\.(css|js)$/.test(u.split('?')[0]), '只有本地 css/js：' + u));
    D.querySelectorAll('[src],[href]').forEach(n => {
      const v = n.getAttribute('src') || n.getAttribute('href');
      ok(!/^(https?:)?\/\//i.test(v), '没有外部地址：' + v);
    });
    D.querySelectorAll('form').forEach(f => ok(!f.getAttribute('action'), '表单没有 action：' + f.id));
    const csp = D.querySelector('meta[http-equiv="Content-Security-Policy"]');
    ok(csp && csp.content.indexOf("connect-src 'none'") !== -1, '有禁止联网的设置');
    ok(csp.content.indexOf("form-action 'none'") !== -1, '有禁止提交表单的设置');
  });

  test('偏好只留在这个标签页：sessionStorage 里只有一条 qp-v0；localStorage、cookie 都是空的；地址栏里也没带回答', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    pick('input[name="q-domain"][value="travel"]');
    pick('input[name="q-output"][value="plan"]');
    pick('input[name="q-audience"][value="family"]');
    setVal('q-wish', '带爸妈去云南');
    eq(W.sessionStorage.length, 1, 'sessionStorage 条数');
    const saved = JSON.parse(W.sessionStorage.getItem('qp-v0'));
    eq(saved.quiz.outputs.join(), 'plan', '存了成果');
    eq(saved.quiz.audiences.join(), 'family', '存了给谁');
    eq(W.localStorage.length, 0, 'localStorage 没东西');
    eq(D.cookie, '', '没有 cookie');
    eq(W.location.search, '', '地址栏没带参数');
    ok(decodeURIComponent(W.location.href).indexOf('云南') === -1, '地址里没有回答');
  });

  async function fullState() {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    pick('input[name="q-domain"][value="life"]');
    pick('input[name="q-domain"][value="travel"]');
    pick('input[name="q-output"][value="text"]');
    pick('input[name="q-audience"][value="family"]');
    setVal('q-wish', '给妈妈过 60 岁生日，想做一本相册');
    $('overflow').open = true;
    $('recs-more').open = true;
    D.querySelector('details.how-copy').open = true;
    D.querySelector('#quiz details.prefs').open = true;
    await wait(50);
  }

  async function overflowAt(width) {
    frame.style.width = width + 'px';
    await wait(100);
    const doc = D.documentElement;
    ok(doc.scrollWidth <= W.innerWidth, width + 'px 宽时页面宽 ' + doc.scrollWidth + '，超出了屏幕');
    D.querySelectorAll('.card, .result, .service, input, select, button').forEach(n => {
      const r = n.getBoundingClientRect();
      if (r.width) ok(r.right <= W.innerWidth + 0.5, width + 'px 宽时有东西超出屏幕：' + (n.id || n.className));
    });
  }

  test('窄屏 320px / 375px：内容填满时也没有横向滚动、没有东西出界', async () => {
    await fullState();
    await overflowAt(320);
    await overflowAt(375);
    frame.style.width = '';
  });

  // ---------------- Copy (#35): users see "size", never "band", and typographic apostrophes ----------------

  // tests/unit.js checks the strings core.js builds. These two check what the page itself shows,
  // so a "band" or a straight apostrophe written into index.html or js/app.js fails too.
  // Checked: every text node outside script and style (hidden ones too: another state shows
  // them), aria-label, title, placeholder and alt, a button's value, a read-only textarea's text
  // (the Copy for Claude fallback) and a meta description. Not checked: ids, classes, data-*,
  // name and storage keys, which are code, not copy.
  const COPY_ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
  const COPY_RULES = [
    ['says "band"', /\bbands?\b/i],
    ['straight apostrophe inside a word', /\w'\w/],
    ['straight apostrophe after a word', /\w'(?!\w)/]
  ];

  // Where copy sits, for failure messages: the nearest id, then the element itself. from: the
  // element a node was added to, named as well when the page has taken the node out again.
  function placeOf(el, from) {
    const host = el ? el.closest('[id]') : null;
    const here = !el ? '' : host === el ? nodeName(el) : (host ? '#' + host.id + ' ' : '') + nodeName(el);
    if (!from || host || (el && el.isConnected)) return here || '(detached)';
    return placeOf(from) + (here ? ' ' + here : '') + ' (since removed)';
  }

  // One element's own copy: the attributes above, its value if it is a button, its text if it is
  // a read-only textarea, its content if it is the meta description.
  function copyOfElement(el, put, from) {
    const at = placeOf(el, from);
    COPY_ATTRS.forEach(a => { if (el.hasAttribute(a)) put(at + ' [' + a + ']', el.getAttribute(a)); });
    const tag = el.tagName;
    if (tag === 'BUTTON' || (tag === 'INPUT' && /^(button|submit|reset)$/i.test(el.type))) put(at + ' [value]', el.value);
    if (tag === 'TEXTAREA' && el.readOnly) put(at + ' (text)', el.value);
    if (tag === 'META' && /^description$/i.test(el.getAttribute('name') || '')) put('meta description [content]', el.getAttribute('content'));
  }

  // put(where, words) for every piece of copy in root: an element and everything in it, or one
  // text node. from: the element root was added to (see placeOf).
  function copyUnder(root, put, from) {
    const code = el => !!(el && el.closest('script, style'));
    if (root.nodeType === 3) {
      if (!code(root.parentElement || from)) put(placeOf(root.parentElement, from), root.data);
      return;
    }
    if (root.nodeType !== 1 || code(root)) return;
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      n => (n.nodeType === 1 && (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT));
    for (let n = root; n; n = walker.nextNode()) {
      if (n.nodeType === 3) put(placeOf(n.parentElement, from), n.data);
      else copyOfElement(n, put, from);
    }
  }

  // items: [state, where, words]. Fails once, listing each problem (a rule broken in one
  // sentence) with the first state and place it showed up in, how many more there were, and
  // the words around it.
  function expectCleanCopy(items, what) {
    const found = new Map();
    items.forEach(([state, where, words]) => {
      const flat = String(words).replace(/\s+/g, ' ').trim();
      COPY_RULES.forEach(([rule, re]) => {
        const m = re.exec(flat);
        if (!m) return;
        const sentence = (flat.slice(0, m.index).match(/[^.!?…]*$/)[0] + flat.slice(m.index).match(/^[^.!?…]*[.!?…]?/)[0]).trim();
        const key = rule + '\n' + sentence;
        if (!found.has(key)) found.set(key, { rule: rule, hits: [], states: new Set(), places: new Set() });
        const f = found.get(key);
        const from = Math.max(0, m.index - 30);
        const to = Math.min(flat.length, m.index + m[0].length + 30);
        f.hits.push({ state: state, where: where, snippet: (from > 0 ? '…' : '') + flat.slice(from, to) + (to < flat.length ? '…' : '') });
        f.states.add(state);
        f.places.add(where);
      });
    });
    const more = (set, noun) => (set.size > 1 ? ', +' + (set.size - 1) + ' more ' + noun : '');
    const lines = Array.from(found.values()).map(f => {
      // Name a place where it stayed on the page, if any, over a node redrawn in the same turn.
      const h = f.hits.find(x => !/\(since removed\)$/.test(x.where)) || f.hits[0];
      return f.rule + ' in [' + h.state + more(f.states, 'states') + '] at ' + h.where + more(f.places, 'places') + ': "' + h.snippet + '"';
    });
    ok(!lines.length, what + ': ' + lines.length + ' problem(s): ' + lines.slice(0, 8).join(' | ') + (lines.length > 8 ? ' | …' : ''));
  }

  // Records the app's copy, tagged with the state it showed up in. at(name, act) names the state,
  // runs act, then files the whole page. Meanwhile a MutationObserver files each text and label
  // the page adds or changes, and a live region's whole text each time it changes (what a screen
  // reader is told), so lines that are said and then cleared (Copied…, New pick…, Filled from
  // Usage.) are checked too.
  function copyRecorder() {
    const items = [];
    let state = '';
    const put = (where, words) => {
      if (typeof words === 'string' && words.trim()) items.push([state, where, words]);
    };
    const LIVE = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]';
    function file(records) {
      const regions = [];
      records.forEach(m => {
        if (m.type === 'childList') m.addedNodes.forEach(n => copyUnder(n, put, m.target));
        else if (m.type === 'characterData') copyUnder(m.target, put);
        else copyOfElement(m.target, put);
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        const region = el && el.closest(LIVE);
        if (region && regions.indexOf(region) === -1) regions.push(region);
      });
      regions.forEach(r => put(placeOf(r) + ' (live region)', r.textContent));
    }
    const mo = new W.MutationObserver(file);
    mo.observe(D.documentElement, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: COPY_ATTRS.concat('value')
    });
    return {
      items: items,
      at: async (name, act) => {
        file(mo.takeRecords());
        state = name;
        if (act) await act();
        await wait(0);
        file(mo.takeRecords());
        copyUnder(D.documentElement, put);
      },
      stop: () => {
        file(mo.takeRecords());
        mo.disconnect();
      }
    };
  }

  test('Copy (#35), index.html as shipped: no "band" and no straight apostrophe in its text (outside script/style), aria-label, title, placeholder, alt, button values or meta description', async () => {
    // Fetched by this page: the app frame's CSP has connect-src 'none'.
    const res = await fetch('../index.html', { cache: 'no-store' });
    eq(res.status, 200, 'GET ../index.html');
    const src = await res.text();
    const doc = new DOMParser().parseFromString(src, 'text/html');
    // index.html:<line> where the words first occur in the source, as written or &-escaped.
    const lineOf = words => {
      const probe = words.trim().split('\n')[0].trim().slice(0, 40);
      const escaped = probe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const at = [probe, escaped].map(p => src.indexOf(p)).find(i => i !== -1);
      return at == null ? 'index.html' : 'index.html:' + src.slice(0, at).split('\n').length;
    };
    const items = [];
    copyUnder(doc.documentElement, (where, words) => {
      if (typeof words === 'string' && words.trim()) items.push(['source', lineOf(words) + ' ' + where, words]);
    });
    expectCleanCopy(items, 'index.html');
    // It read the real page: the title, the size rules, a label and a placeholder are there.
    [/^Leftover Claude quota\?$/, /^How is the (size|band) chosen\?$/, /If you.re limited by Session/, /^Claude usage$/, /^e\.g\. Mom.s 60th birthday/]
      .forEach(re => ok(items.some(i => re.test(i[2])), 'index.html: nothing matched ' + re));
  });

  test('Copy (#35), the page in every main state (Fill, each size and nothing left, preferences, edited numbers, Copy for Claude, Not this one, Mark done, every <details> open): no "band" and no straight apostrophe in any text, label or live-region announcement', async () => {
    const usage = fixtureUsage();
    await fresh();
    await reloadApp(); // a first visit: nothing saved, nothing typed
    const rec = copyRecorder();
    const at = rec.at;
    const size = () => resultOf('claude') && resultOf('claude').dataset.band;
    let restoreClip = () => {};
    try {
      await at('fresh page');

      // Fill from Claude Usage: no extension, an unreadable Usage page, a read, a second read.
      await at('Fill, no extension', async () => {
        removeUsageBridge();
        $('fill-usage-btn').click();
        await wait(1700);
      });
      await at('Fill, Usage unreadable', async () => {
        installUsageBridge(() => ({ ok: false, error: 'parse' }));
        $('fill-usage-btn').click();
        await flushFill();
      });
      await at('Fill, read', async () => {
        installUsageBridge(() => ({ ok: true, usage: usage }));
        $('fill-usage-btn').click();
        await flushFill();
      });
      await at('Fill, read again', async () => {
        $('fill-usage-btn').click();
        await flushFill();
      });
      await at('percentages as % left', () => pick('input[name="claude-mode"][value="left"]'));
      pick('input[name="claude-mode"][value="used"]');

      // Get project with no plan, with API billing, with numbers that do not work.
      await at('Get project, no plan', () => { setVal('claude-plan', ''); calc(); });
      await at('Get project, API billing', () => { setVal('claude-plan', 'api'); calc(); });
      await at('Get project, wrong numbers', () => {
        fill('claude', { s: 150, w: 30 });
        setVal('claude-w-day', '');
        calc();
      });

      // Each size, and nothing left (waiting on Session, then on Weekly), with no preferences.
      for (const [name, want, o] of [
        ['Small', 'small', { s: 85, w: 30 }],
        ['Medium', 'medium', { s: 72, h: 3, m: 12, w: 31 }],
        ['Large', 'large', { s: 30, w: 40 }],
        ['Nothing left (Session)', 'none', { s: 100, w: 50 }],
        ['Nothing left (Weekly)', 'none', { s: 20, w: 100 }]
      ]) {
        await at(name + ', Get project, no preferences', () => { fill('claude', o); calc(); });
        eq(size(), want, name + ': size');
      }
      await at('Large, numbers changed after Get project', () => {
        fill('claude', { s: 30, w: 40 });
        calc();
        setVal('claude-s-pct', '35');
      });

      // Preferences: every question answered, every <details> opened, then answers nothing matches.
      await at('Large, Get project with every question answered', () => {
        pick('input[name="q-domain"][value="travel"]');
        setVal('q-other', 'pets');
        setVal('q-wish', 'plan a weekend trip');
        pick('input[name="q-output"][value="plan"]');
        pick('input[name="q-audience"][value="family"]');
        calc();
      });
      ok(cards().length === 1 && moreCards().length > 0, 'a hero and More projects');
      await at('every <details> open', () => D.querySelectorAll('details').forEach(d => { d.open = true; }));
      await at('Small, Get project with answers no project matches', () => {
        unpick('input[name="q-domain"][value="travel"]');
        unpick('input[name="q-output"][value="plan"]');
        unpick('input[name="q-audience"][value="family"]');
        setVal('q-wish', '');
        setVal('q-other', 'xyzzy'); // in no project's words
        fill('claude', { s: 85, w: 30 });
        calc();
      });
      eq(cards().length, 1, 'a Small hero');

      // Copy for Claude: copied (label and live region), then a refused write (the manual-copy box).
      await at('Copy for Claude, copied', async () => {
        restoreClip = setClipboard(fakeClipboard(writeOk));
        copyBtnOf(cards()[0]).click();
        await wait(150); // the live region speaks 100ms after the click
      });
      restoreClip();
      await at('Copy for Claude, write refused', async () => {
        restoreClip = setClipboard(fakeClipboard(writeDenied));
        copyBtnOf(cards()[0]).click();
        await wait(0);
      });
      restoreClip();
      restoreClip = () => {};
      eq(shownAreas(cards()[0]).length, 1, 'the manual-copy box is open');

      // Not this one until the size runs out: each New pick line, then the run-out line.
      const picks = cards().length + moreCards().filter(c => c.dataset.band === 'small').length;
      for (let i = 1; i <= picks; i++) {
        await at(i < picks ? 'Not this one, swap ' + i : 'Not this one, the size ran out', async () => {
          notBtn().click();
          await wait(150); // New pick is said 100ms after the click
        });
      }
      ok(outLine() && notBtn().getAttribute('aria-disabled') === 'true', 'the size ran out');

      // Mark done, Fill again, then Mark done until every ready-made Small project is finished.
      await at('Get project again', () => calc());
      await at('Mark done', () => cards()[0].querySelector('.done-btn').click());
      await at('Fill again', async () => {
        $('recalc-btn').click();
        await flushFill();
      });
      await at('Get project after Fill again', () => calc());
      await at('Small, Mark done until every ready-made project is finished', () => {
        setVal('q-other', '');
        fill('claude', { s: 85, w: 30 });
        calc();
        for (let i = 0; i < 30 && cards().length; i++) {
          cards()[0].querySelector('.done-btn').click();
          calc();
        }
      });
      eq(cards().length, 0, 'every Small project is done');
      await at('every ready-made project finished, then a wish written', () => setVal('q-wish', 'tidy the closet'));
      ok(cards().length === 1 && cards()[0].dataset.id.indexOf('custom:') === 0, 'only the card built from the wish');
      await at('Clear my answers', () => $('clear-btn').click());
    } finally {
      rec.stop();
      restoreClip();
      removeUsageBridge();
    }
    expectCleanCopy(rec.items, 'page');
    // The walk reached every state: each of these was shown, said or labeled at least once
    // (where: the place it must be in). Apostrophes and size words are loose here, so a bad
    // copy edit fails the check above, not this one.
    [
      [/^Reading Usage/, '#fill-status'],
      [/^No extension\? No problem\./, '#fill-status'],
      [/^Couldn.t read Usage\./, '#fill-status'],
      [/^Filled from Usage\.$/, '#fill-status'],
      [/^Updated from Usage\.$/, '#fill-status'],
      [/^Session percent left$/, '#claude-s-pct'],
      [/^Choose a plan, then Get project\.$/, '#calc-results'],
      [/^Get project to see a recommendation\.$/, '#recs-status'],
      [/no session\/weekly window/, '#calc-results'],
      [/^Missing Session \/ Resets in \/ Weekly$/, '#calc-results'],
      [/Small \(About 15–30 minutes\)\. Only this (size|band)\.$/, '#recs-status'],
      [/Medium \(About an hour\)\. Only this (size|band)\.$/, '#recs-status'],
      [/Large \(About 2–3 hours\)\. Only this (size|band)\.$/, '#recs-status'],
      [/^Claude has nothing left\. Wait for Session to reset/, '#recs-status'],
      [/^Claude has nothing left\. Wait for Weekly to reset/, '#recs-status'],
      [/^You changed the numbers\. Click Get project to update\.$/, '#calc-results'],
      [/^You changed the numbers and haven.t clicked Get project\./, '#recs-status'],
      [/^No preferences yet\. Picks go in list order\.$/, '#recs-status'],
      [/^Sorted by your answers — Area: Travel, pets; Want to do: plan a weekend trip; /, '#recs-status'],
      [/^Nothing this (size|band) matches what you picked/, '#recs-status'],
      [/^Copied\. Go paste\.$/, '#recs-list'],
      [/^Copied\. Paste it into Claude\.$/, '#recs-list'],
      [/^Text for Claude$/, '#recs-list'],
      [/What you.ll end with: /, '#recs-list'],
      [/^New pick: /, '#pick-live'],
      [/^That.s every pick that fits this quota\./, '#pick-live'],
      [/^These numbers are out of date\./, '#stale-warn'],
      [/^Finished 1 this round: /, '#recs-status'],
      [/^You.ve finished every ready-made project in this (size|band)\. Look at a smaller one/, '#recs-status'],
      [/^You.ve finished every ready-made project in this (size|band)\. You can do the card built/, '#recs-status'],
      [/^Cleared quiz answers, step 1 numbers, and finished projects\.$/, '#clear-msg'],
      [/^How is the (size|band) chosen\?$/, '#overflow']
    ].forEach(([re, where]) => ok(rec.items.some(i => re.test(i[2]) && i[1].indexOf(where) === 0),
      'never saw ' + re + ' in ' + where + ': the walk did not reach that state'));
  });

  test('整个测试过程中页面没有脚本报错', () => {
    eq(appErrors.length, 0, appErrors.join(' / '));
  });

  window.addEventListener('load', async () => {
    await runTests();
    const shot = Number(new URLSearchParams(location.search).get('shot'));
    if (shot) {
      await fullState();
      frame.style.width = shot + 'px';
      await wait(100);
      frame.style.height = D.documentElement.scrollHeight + 'px';
      document.querySelector('.report').style.display = 'none';
    }
  });
})();
