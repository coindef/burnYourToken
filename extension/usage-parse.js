/*
 * Read Session / Resets in / Weekly from a Claude Usage-like DOM.
 * No network. Call this only after the user clicks Fill.
 * Returns plain strings the step 1 fields already accept.
 */
(function () {
  'use strict';

  const WHEN = 'today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat';
  const CLOCK = '(\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)|\\d{1,2}:\\d{2})';

  function pad(n) {
    n = Number(n);
    return (n < 10 ? '0' : '') + n;
  }

  function pctString(n) {
    if (!isFinite(n)) return '';
    const x = Math.round(n * 10) / 10;
    if (x < 0 || x > 100) return '';
    return String(x);
  }

  function hidden(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute('hidden')) return true;
    const inline = (el.getAttribute('style') || '').replace(/\s/g, '').toLowerCase();
    if (inline.indexOf('display:none') !== -1 || inline.indexOf('visibility:hidden') !== -1) return true;
    try {
      const view = el.ownerDocument && el.ownerDocument.defaultView;
      if (view && el.isConnected) {
        const style = view.getComputedStyle(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
      }
    } catch (e) { /* detached documents still parse from text */ }
    return false;
  }

  function visibleText(root) {
    const start = root && root.nodeType === 9 ? (root.body || root.documentElement) : root;
    let out = '';
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        out += node.nodeValue.replace(/[ \t\f\v]+/g, ' ');
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node;
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return;
      if (hidden(el)) return;
      if (tag === 'BR') {
        out += '\n';
        return;
      }
      const block = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TR|UL)$/.test(tag);
      if (el.getAttribute('role') === 'progressbar' && el.hasAttribute('aria-valuenow') && !/%/.test(el.textContent || '')) {
        const pct = barPercent(el);
        if (pct) out += '\n' + pct + '% used\n';
      }
      if (block) out += '\n';
      const kids = el.childNodes;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
      if (block) out += '\n';
    }
    walk(start);
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  function barPercent(el) {
    const maxAttr = el.getAttribute('aria-valuemax');
    const max = maxAttr == null || maxAttr === '' ? 100 : Number(maxAttr);
    const now = Number(el.getAttribute('aria-valuenow'));
    if (!isFinite(now) || !isFinite(max) || max <= 0) return '';
    const pct = max === 100 ? now : (now / max) * 100;
    return pctString(pct);
  }

  function collectPercents(slice) {
    const re = /(\d+(?:\.\d+)?)\s*%\s*(used|left|remaining)/gi;
    const matches = [];
    let m;
    while ((m = re.exec(slice))) {
      matches.push({ index: m.index, length: m[0].length, pct: m[1], word: m[2] });
    }
    return matches.map((item, i) => {
      const start = i === 0 ? 0 : matches[i - 1].index + matches[i - 1].length;
      const segment = slice.slice(start, item.index + item.length);
      const mode = /left|remaining/i.test(item.word) ? 'left' : 'used';
      const n = Number(item.pct);
      return {
        pct: pctString(n),
        mode: mode,
        used: mode === 'left' ? 100 - n : n,
        segment: segment
      };
    }).filter(item => item.pct !== '');
  }

  function pickFullest(items) {
    let best = null;
    items.forEach(item => {
      if (!best || item.used > best.used) best = item;
      else if (item.used === best.used && /all models/i.test(item.segment) && !/all models/i.test(best.segment)) best = item;
    });
    return best;
  }

  function emptyReset() {
    return { kind: 'none', h: '', m: '', clock: '', day: '' };
  }

  function parseClockPhrase(text) {
    const raw = String(text || '').toLowerCase().replace(/\./g, '').trim();
    const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return '';
    if (!m[2] && !m[3]) return '';
    let h = Number(m[1]);
    const min = m[2] == null ? 0 : Number(m[2]);
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59 || h < 0 || min < 0) return '';
    return pad(h) + ':' + pad(min);
  }

  function dayFromToken(token, now) {
    const t = String(token || '').toLowerCase();
    if (t === 'today') return String(now.getDay());
    if (t === 'tomorrow') return String((now.getDay() + 1) % 7);
    const full = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const idx = full.indexOf(t);
    if (idx >= 0) return String(idx);
    const short = { sun: '0', mon: '1', tue: '2', tues: '2', wed: '3', thu: '4', thur: '4', thurs: '4', fri: '5', sat: '6' };
    return Object.prototype.hasOwnProperty.call(short, t) ? short[t] : '';
  }

  function parseCountdown(line) {
    let m = line.match(/\bresets in\s+(\d+)\s*(?:hours|hour|hrs|hr|h)\b(?:\s*(?:,|and)?\s*(\d+)\s*(?:minutes|minute|mins|min|m)\b)?/i);
    if (m) return { h: String(Number(m[1])), m: String(m[2] == null ? 0 : Number(m[2])) };
    m = line.match(/\bresets in\s+(\d+)\s*(?:minutes|minute|mins|min|m)\b/i);
    if (m) return { h: '0', m: String(Number(m[1])) };
    return null;
  }

  function parseDatedReset(line, now) {
    const re = new RegExp('\\bresets(?:\\s+on)?\\s+(' + WHEN + ')\\b\\.?\\s*,?(?:\\s*(?:at\\s+)?' + CLOCK + ')?', 'i');
    const m = line.match(re);
    if (!m) return null;
    const day = dayFromToken(m[1], now);
    const clock = m[2] ? parseClockPhrase(m[2]) : '';
    if (!day && !clock) return null;
    return { kind: clock ? 'clock' : 'none', h: '', m: '', clock: clock, day: day };
  }

  function parseReset(segment, now) {
    const line = segment.replace(/\s+/g, ' ').trim();
    if (/starts when a message is sent/i.test(line)) return emptyReset();
    const countdown = parseCountdown(line);
    if (countdown) return { kind: 'countdown', h: countdown.h, m: countdown.m, clock: '', day: '' };
    const dated = parseDatedReset(line, now);
    if (dated) return dated;
    const clockOnly = line.match(new RegExp('\\bresets(?:\\s+at)?\\s+' + CLOCK, 'i'));
    if (clockOnly) {
      const clock = parseClockPhrase(clockOnly[1]);
      if (clock) return { kind: 'clock', h: '', m: '', clock: clock, day: '' };
    }
    return emptyReset();
  }

  function parseUsageRoot(root, now) {
    const clock = now instanceof Date ? now : new Date();
    const text = visibleText(root);
    const sessionAt = text.search(/current session/i);
    if (sessionAt < 0) return { ok: false };
    const rest = text.slice(sessionAt);
    const weeklyAt = rest.search(/\bweekly limits\b|\bcurrent week\b|\ball models\b/i);
    if (weeklyAt < 0) return { ok: false };
    const sessionSlice = rest.slice(0, weeklyAt);
    let weeklySlice = rest.slice(weeklyAt);
    const creditsAt = weeklySlice.search(/\busage credits\b|\bextra usage\b/i);
    if (creditsAt >= 0) weeklySlice = weeklySlice.slice(0, creditsAt);
    const sessionItems = collectPercents(sessionSlice);
    const weeklyItems = collectPercents(weeklySlice);
    if (!sessionItems.length || !weeklyItems.length) return { ok: false };
    const session = sessionItems[0];
    const weekly = pickFullest(weeklyItems);
    if (!weekly || session.mode !== weekly.mode) return { ok: false };
    const sessionReset = parseReset(session.segment, clock);
    const weeklyReset = parseReset(weekly.segment, clock);
    return {
      ok: true,
      mode: session.mode,
      sessionPct: session.pct,
      sessionResetType: sessionReset.kind,
      sessionH: sessionReset.h,
      sessionM: sessionReset.m,
      sessionClock: sessionReset.clock,
      weeklyPct: weekly.pct,
      weeklyDay: weeklyReset.day,
      weeklyClock: weeklyReset.clock
    };
  }

  window.parseUsageRoot = parseUsageRoot;
})();
