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
  const FILL_NO_EXT = 'Extension not found. Load it from the README, or type the numbers.';
  const FILL_PARSE = 'Couldn\'t read Usage. Keep Claude → Settings → Usage open, then try again — or copy by hand.';

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
    eq(resultOf('claude').dataset.band, 'medium', '示例一点就算出中档');
    ok(text($('band-chips')).indexOf('Medium') !== -1 && text($('band-chips')).indexOf('About an hour') !== -1, 'band chips');
    eq(cards().length, 1, 'Try sample 直接出一张推荐');
    eq(D.querySelectorAll('#calc-results .result, #calc-results .card').length, 0, 'results are chips, not a card');

    setVal('claude-plan', 'max20');
    $('example-btn').click();
    eq($('claude-plan').value, 'max20', '已经选了档就不改');
    setVal('claude-plan', 'api');
    ok($('claude-body').hidden, 'API 先把格子收起来');
    $('example-btn').click();
    eq($('claude-plan').value, 'pro', 'API 用示例时改回 Pro');
    ok(!$('claude-body').hidden, '格子又打开');
    eq($('claude-s-pct').value, '72', '① 还是示例');

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
    const readme = $('fill-status').querySelector('a');
    ok(readme && readme.getAttribute('href') === 'README.md#load-unpacked-30-seconds' && readme.textContent === 'README', 'links to README install');
    eq($('claude-s-pct').value, '', 'still empty');
    eq(text($('calc-results')).trim(), '', 'no extension does not calculate');
    eq(D.querySelector('main').dataset.phase, 'first', 'failed Fill stays on the first screen');
    ok(!isShown($('usage-fields')), 'failed Fill does not reveal fields');

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
    eq(shownButtons().filter(b => b.classList.contains('secondary')).length, 0, 'no other secondary CTA');
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
    eq($('fill-status').textContent, FILL_OK, 'success again');
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
    eq($('fill-status').textContent, FILL_OK, 'clock fill success');
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
      if (whyOf(c).indexOf("preferences don't") !== -1) eq(c.dataset.band, 'large', c.dataset.id + ' 没对上的仍是同档');
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
        ok(whyOf(n).indexOf('by band') !== -1, n.dataset.id + ' 写着按档位挑');
        ok(!n.querySelector('.top-tag') && !n.querySelector('.badge'), n.dataset.id + ' 没有芯片');
      });
      eq(cards().concat(moreCards()).filter(n => n.dataset.band === c[1]).length, bandCount(c[1]), c[1] + '：其余同档在 More projects');
      ok(!$('recs-more').hidden, 'More projects 收着其余的');
      ok(statusText().indexOf('skipped') !== -1, '状态里说了是跳过的');
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
      ok(text($('done-banner')).indexOf('Nice. Fill again when you’re ready.') !== -1, text($('done-banner')));
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
        ok(statusText().indexOf('Nothing in this band matches') !== -1, '对上的做完了 → 说明是退回列出这一档的');
        eq(moreCards().length, total - i - 1, '其余的在 More projects');
      }
      cards()[0].querySelector('.done-btn').click();
      calc();
    }
    eq(cards().length, 0, '全做完了');
    ok(statusText().indexOf('finished every ready-made project') !== -1, '告诉你都做完了');
    ok(statusText().indexOf('Nothing in this band matches') === -1, '不再说先列出来');
    setVal('q-wish', '整理衣柜');
    eq(cards().length, 1, '写了想做的事 → 只剩那张现做的');
    ok(cards()[0].dataset.id === 'custom:整理衣柜', '是现做的那张');
    ok(statusText().indexOf('card built from what you wrote') !== -1 && statusText().indexOf('Nothing in this band matches') === -1, statusText());
  });

  test('做完一个 → 提示回去重新算 → 重新算后推下一个，做完的不再出现', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 }); // 大档
    calc();
    const first = cards()[0];
    const doneId = first.dataset.id;
    first.querySelector('.done-btn').click();
    ok(!$('done-banner').hidden, '出现「做完了」提示');
    ok(text($('done-banner')).indexOf('Fill again when you’re ready.') !== -1, '提示再 Fill 一次');
    eq(cards().length, 0, '重新算之前不推下一个');
    ok(text($('calc-results')).indexOf('out of date') !== -1, '计算结果标为过时');
    $('recalc-btn').click();
    eq(D.activeElement && D.activeElement.id, 'fill-usage-btn', 'Fill again 回到 Fill 按钮');
    eq($('fill-status').textContent, 'Reading Usage…', 'Fill again 直接触发 Fill');
    setVal('claude-s-pct', '60'); // 做完项目用掉了一些：剩 40% → 中档
    calc();
    ok($('done-banner').hidden, '提示消失');
    eq(resultOf('claude').dataset.band, 'medium', '新档位');
    ok(cards().length > 0, '推了下一批');
    ok(cards().every(c => c.dataset.id !== doneId && c.dataset.band === 'medium'), '没有做完的，档位跟着新剩余');
    ok(statusText().indexOf('Finished 1 this round') !== -1, '记着做完了几个');
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
    ok(statusText().indexOf("haven't clicked Get project") !== -1, '第 3 步提示');
    calc();
    ok(statusText().indexOf("haven't clicked Get project") === -1, '算完提示消失');
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
    eq(text($('restore-note')).trim(), 'Restored from this tab. Check Usage, then Get project.', 'restore hint copy');
    W.QP.app.clearAll();
    await reloadApp();
    eq($('claude-plan').value, '', '清除后没有带回');
    ok($('restore-note').hidden, '没有提示');
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
