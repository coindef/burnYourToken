/*
 * Real scroll positions for prefers-reduced-motion.
 * The runner (motion_run.py) turns the preference on and off in the browser,
 * then calls runMotion('instant' | 'smooth'). This file does not stub matchMedia
 * and does not trust the options object passed to scrollIntoView.
 *
 * A jump is instant only when the resting position is already reached once the
 * click's microtasks finish, and later frames do not creep. A smooth scroll is
 * still near the start at that moment and then paints intermediate positions.
 */
(function () {
  'use strict';

  const frame = document.getElementById('app');
  let W = null;
  let D = null;
  let bridgeOn = false;
  const MIN_TRAVEL = 400;

  const USAGE = {
    plan: 'pro',
    mode: 'used',
    sessionPct: 72,
    sessionResetType: 'countdown',
    sessionH: 3,
    sessionM: 12,
    weeklyPct: 31,
    weeklyDay: '4',
    weeklyClock: '08:00'
  };

  function raf() {
    return new Promise(resolve => W.requestAnimationFrame(resolve));
  }

  function scrollTop() {
    return W.document.scrollingElement.scrollTop;
  }

  function mediaNow() {
    return {
      reduce: !!W.matchMedia('(prefers-reduced-motion: reduce)').matches,
      css: W.getComputedStyle(W.document.documentElement).scrollBehavior
    };
  }

  async function settled() {
    let last = scrollTop();
    let stable = 0;
    while (stable < 4) {
      await raf();
      const y = scrollTop();
      if (Math.abs(y - last) < 0.5) stable += 1;
      else stable = 0;
      last = y;
    }
    return last;
  }

  // Cancel any in-flight smooth scroll and wait until the position stays put.
  async function park(top) {
    const html = W.document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    W.document.scrollingElement.scrollTop = top;
    await raf();
    html.style.scrollBehavior = prev;
    await settled();
    const y = scrollTop();
    if (Math.abs(y - top) > 2) throw new Error('park did not settle at ' + top + ' (at ' + Math.round(y) + ')');
  }

  function installBridge() {
    if (bridgeOn) return;
    bridgeOn = true;
    W.addEventListener('message', event => {
      if (event.source !== W) return;
      const data = event.data;
      if (!data || data.source !== 'byt-page' || data.type !== 'fill-request') return;
      W.QP.app.postToPage({
        source: 'byt-extension',
        type: 'fill-result',
        id: data.id,
        ok: true,
        usage: USAGE
      });
    });
  }

  function loadApp() {
    return new Promise((resolve, reject) => {
      frame.onload = () => {
        try {
          W = frame.contentWindow;
          D = W.document;
        } catch (e) {
          reject(new Error('iframe not readable'));
          return;
        }
        if (!W.QP || !W.QP.app) {
          reject(new Error('app did not start'));
          return;
        }
        installBridge();
        resolve();
      };
      frame.src = '../index.html';
    });
  }

  function focusDesc() {
    const el = D.activeElement;
    if (!el || el === D.body || el === D.documentElement) return 'body';
    const heroTitle = D.querySelector('#recs-list .card.hero h3');
    if (heroTitle && el === heroTitle) return 'hero-title';
    if (el.id) return '#' + el.id;
    return el.tagName;
  }

  function inView(node) {
    if (!node) return false;
    const r = node.getBoundingClientRect();
    return r.top >= -1 && r.bottom <= W.innerHeight + 1 && r.height > 0;
  }

  function uniqRounded(values) {
    const out = [];
    values.forEach(y => {
      const r = Math.round(y);
      if (!out.length || Math.abs(out[out.length - 1] - r) > 1) out.push(r);
    });
    return out;
  }

  // before: settled position. afterCalls: position once the click's microtasks ran.
  // frames: animation frames after that, until the position stops changing.
    // Smooth: frames walk through the gap. Instant: one jump, including the
    // jump Fill again schedules on the next frame so layout can settle.
  function classify(before, afterCalls, frames) {
    const end = frames.length ? frames[frames.length - 1] : afterCalls;
    const travel = Math.abs(end - before);
    const movedDuringCall = Math.abs(afterCalls - before);
    const remaining = Math.abs(end - afterCalls);
    const lo = Math.min(afterCalls, end);
    const hi = Math.max(afterCalls, end);
    const between = uniqRounded(frames.filter(y => y > lo + 2 && y < hi - 2));
    const drifted = frames.some(y => Math.abs(y - afterCalls) > 1);
    const uniq = uniqRounded([before, afterCalls].concat(frames));
    const span = Math.max(travel, movedDuringCall, remaining);
    let kind = 'unclear';
    if (remaining >= MIN_TRAVEL && between.length >= 3) kind = 'smooth';
    else if (between.length === 0 && remaining <= 1 && !drifted && movedDuringCall >= MIN_TRAVEL) kind = 'instant';
    else if (between.length === 0 && remaining >= MIN_TRAVEL) kind = 'instant';
    else if (span < MIN_TRAVEL) kind = 'too-short';
    return {
      kind: kind,
      before: Math.round(before),
      afterCalls: Math.round(afterCalls),
      end: Math.round(end),
      travel: Math.round(travel),
      movedDuringCall: Math.round(movedDuringCall),
      remaining: Math.round(remaining),
      frames: frames.length,
      uniq: uniq.slice(0, 14)
    };
  }

  async function watch(clickFn) {
    const before = scrollTop();
    clickFn();
    // Let Fill again's awaited usage reply scroll once, still before the next paint.
    await Promise.resolve();
    await Promise.resolve();
    const afterCalls = scrollTop();
    const frames = [];
    let stable = 0;
    let guard = 0;
    while (guard < 180) {
      await raf();
      guard += 1;
      const y = scrollTop();
      frames.push(y);
      if (frames.length >= 2 && Math.abs(y - frames[frames.length - 2]) < 0.5) stable += 1;
      else stable = 0;
      if (stable >= 4 && guard >= 4) break;
    }
    const settledOk = stable >= 4;
    const motion = classify(before, afterCalls, frames);
    motion.settled = settledOk;
    motion.hitFrameCap = !settledOk;
    return motion;
  }

  function heroTitle() {
    return D.querySelector('#recs-list .card.hero h3');
  }

  async function prepareGet() {
    W.QP.app.clearAll();
    D.getElementById('clear-msg').hidden = true;
    D.getElementById('example-btn').click();
    await Promise.resolve();
    await park(0);
    if (!D.getElementById('calc-btn') || D.getElementById('usage-fields').hidden) {
      throw new Error('Try sample did not open Get project');
    }
  }

  async function runGet() {
    await prepareGet();
    const motion = await watch(() => D.getElementById('calc-btn').click());
    const title = heroTitle();
    return Object.assign(motion, {
      action: 'Get project',
      focus: focusDesc(),
      focusOk: !!title && D.activeElement === title,
      placeOk: inView(title)
    });
  }

  async function runMarkDone() {
    if (!heroTitle()) await runGet();
    await park(0);
    const btn = D.querySelector('#recs-list .card.hero .done-btn');
    if (!btn) throw new Error('no Mark done button');
    const motion = await watch(() => btn.click());
    const again = D.getElementById('recalc-btn');
    return Object.assign(motion, {
      action: 'Mark done',
      focus: focusDesc(),
      focusOk: D.activeElement === again,
      placeOk: inView(again)
    });
  }

  async function runFillAgain() {
    const again = D.getElementById('recalc-btn');
    if (!again || again.hidden || !D.getElementById('done-banner') || D.getElementById('done-banner').hidden) {
      await runMarkDone();
    }
    // Final place is the Get project button, well below the top. Starting at 0
    // makes that scroll long; the bottom of the page sits too close to it.
    await park(0);
    const motion = await watch(() => D.getElementById('recalc-btn').click());
    const getBtn = D.getElementById('calc-btn');
    return Object.assign(motion, {
      action: 'Fill again',
      focus: focusDesc(),
      focusOk: D.activeElement === getBtn,
      placeOk: inView(getBtn)
    });
  }

  function judge(row, expectKind) {
    const problems = [];
    if (!row.settled) problems.push('scroll did not settle before the frame cap');
    if (row.kind === 'too-short') problems.push('travel ' + row.travel + 'px is under ' + MIN_TRAVEL + 'px; target was not far enough');
    else if (row.kind !== expectKind) problems.push('motion ' + row.kind + ', expected ' + expectKind);
    if (!row.focusOk) problems.push('focus ' + row.focus);
    if (!row.placeOk) problems.push('target not fully in view');
    row.ok = problems.length === 0;
    row.problems = problems;
    row.expect = expectKind;
    return row;
  }

  let loading = null;
  window.runMotion = async function (expectKind) {
    if (expectKind !== 'instant' && expectKind !== 'smooth') {
      throw new Error('expected instant or smooth');
    }
    if (!loading) loading = loadApp();
    await loading;
    const rows = [];
    rows.push(judge(await runGet(), expectKind));
    rows.push(judge(await runMarkDone(), expectKind));
    rows.push(judge(await runFillAgain(), expectKind));
    const media = mediaNow();
    const ok = rows.every(r => r.ok);
    const summary = document.getElementById('summary');
    const out = document.getElementById('out');
    rows.forEach(r => {
      const li = document.createElement('li');
      li.className = r.ok ? 'pass' : 'fail';
      li.textContent = (r.ok ? 'pass ' : 'fail ') + r.action + ' ' + r.kind + ' focus=' + r.focus +
        (r.problems.length ? ' — ' + r.problems.join('; ') : '');
      out.appendChild(li);
    });
    summary.textContent = (ok ? 'PASS ' : 'FAIL ') + expectKind;
    summary.className = ok ? 'pass' : 'fail';
    return { ok: ok, expect: expectKind, media: media, rows: rows };
  };
})();
