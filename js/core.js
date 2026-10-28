/*
 * 纯计算逻辑：不碰页面、不联网。index.html 和 tests/ 都用它。
 *
 * 剩余额度 → 档位（已定的规格）：
 *   剩 5 小时额度 = 100% - 已用；剩每周额度 = 100% - 已用；有效剩余 = 两者取小。
 *   大 = 两个窗口都剩 > 50%，并且离每周额度重置 > 1 天
 *   中 = 任一窗口剩 20%–50%
 *   小 = 任一窗口剩 < 20%，或者离每周额度重置只剩几小时（< 5 小时）
 *   两条同时成立时取小的那个，绝不往大了算。
 * 档位是经验规则，不是厂商数字。每个服务单独算，这里没有任何跨服务相加的函数。
 */
(function () {
  'use strict';
  const QP = window.QP = window.QP || {};

  // 档位从小到大。none = 已经用完，先等重置。
  const BANDS = ['none', 'small', 'medium', 'large'];

  const BAND_INFO = {
    none: { label: 'Nothing left', time: 'Wait for a reset' },
    small: { label: 'Small', time: 'About 15–30 minutes' },
    medium: { label: 'Medium', time: 'About an hour' },
    large: { label: 'Large', time: 'About 2–3 hours' }
  };

  // 经验规则（不是厂商数字）。改这里时，index.html 里「档位是怎么算的」也要一起改。
  const RULES = {
    largeAbove: 50, // 两个窗口都 > 50% → 按剩余能做大（50% 正好算中）
    smallBelow: 20, // 任一窗口 < 20% → 小；20%–50% → 中；0 → 没有剩余
    largeWeeklyHours: 24, // 大档还要离每周额度重置 > 1 天；不到 1 天最多中档
    fewHours: 5, // 离每周额度重置只剩「几小时」（< 5 小时，不到一个 5 小时窗口）→ 最多小档
    sessionSoonHours: 1, // 卡在 5 小时额度、它又不到 1 小时就重置 → 提醒重置后再算
    sessionHours: 5 // 5 小时额度还没开始用时，按整整 5 小时算
  };

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const WINDOW_NAME = { session: 'Session', weekly: 'Weekly' };
  const HOUR = 3600 * 1000;

  QP.now = QP.now || function () { return new Date(); };

  function rank(band) { return BANDS.indexOf(band); }

  // 只看百分比：pct 是有效剩余（两个窗口取小）
  function bandFromRemaining(pct) {
    if (!(pct > 0)) return 'none';
    if (pct < RULES.smallBelow) return 'small';
    if (pct <= RULES.largeAbove) return 'medium';
    return 'large';
  }

  // 再看离每周额度重置还有多久：只剩几小时 → 最多小；不到 1 天 → 最多中
  function weeklyTimeCap(weeklyHours) {
    if (weeklyHours < RULES.fewHours) return 'small';
    if (weeklyHours <= RULES.largeWeeklyHours) return 'medium';
    return 'large';
  }

  function blank(v) { return v == null || String(v).trim() === ''; }

  // 全角数字和符号 → 半角（中文输入法常打出 ８０、８：００）
  function half(v) {
    return String(v == null ? '' : v)
      .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[．。]/g, '.').replace(/：/g, ':').replace(/％/g, '%')
      .trim();
  }

  // 非负数："2"、"2.5"、".5"、"８０" → 数字；不合法 → NaN
  function parseAmount(v) {
    const s = half(v);
    return /^(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
  }

  // "80"、"80%"、"80 %"、"８０％" → 80；不合法 → NaN
  function parsePct(v) {
    if (blank(v)) return NaN;
    return parseAmount(half(v).replace(/%$/, ''));
  }

  // "8:05"、"08:05"、"20：05"、"０８：００"、"08:05:00" → { h, m }；不合法 → null
  function parseClock(v) {
    if (blank(v)) return null;
    const m = half(v).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h <= 23 && min <= 59 ? { h: h, m: min } : null;
  }

  // 下一次到 h:m 还有几小时（已经过了或正好是现在 → 算明天的）
  function hoursUntilClock(clock, now) {
    const t = new Date(now.getTime());
    t.setHours(clock.h, clock.m, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    return (t - now) / HOUR;
  }

  // 下一个「周几 几点」还有几小时。day：0 = 周日 … 6 = 周六。
  // 没填几点：按那天 0 点算（最早的可能）；如果就是今天，没法知道过没过，按马上重置算。
  function hoursUntilWeekly(day, clock, now) {
    const diff = (day - now.getDay() + 7) % 7;
    const t = new Date(now.getTime());
    if (!clock) {
      if (diff === 0) return { hours: 0, guess: 'today' };
      t.setHours(0, 0, 0, 0);
      t.setDate(t.getDate() + diff);
      return { hours: (t - now) / HOUR, guess: 'midnight' };
    }
    t.setHours(clock.h, clock.m, 0, 0);
    t.setDate(t.getDate() + diff);
    if (t <= now) t.setDate(t.getDate() + 7);
    return { hours: (t - now) / HOUR, guess: null };
  }

  function formatHours(h) {
    const total = Math.round(h * 60);
    if (total <= 0) return 'any moment';
    const d = Math.floor(total / 1440);
    const hr = Math.floor((total % 1440) / 60);
    const m = total % 60;
    const hours = hr + ' hr';
    const mins = m + ' min';
    if (d) return d + (d === 1 ? ' day' : ' days') + (hr ? ' ' + hours : '');
    if (hr) return hours + (m ? ' ' + mins : '');
    return mins;
  }

  // "in 3 hr"; already due → "resets any moment"
  function formatUntil(h) {
    return Math.round(h * 60) <= 0 ? 'resets any moment' : 'in ' + formatHours(h);
  }

  /*
   * 算一个服务的剩余档位。
   * input: {
   *   plan, mode: 'used' | 'left'（用量页上写的是已用还是还剩）,
   *   sessionPct, sessionResetType: 'countdown' | 'clock', sessionH, sessionM, sessionClock,
   *   weeklyPct, weeklyDay: '0'–'6', weeklyClock
   * }
   * 返回 { ok: false, errors: [{ field, msg }] } 或 { ok: true, band, ... }
   */
  function computeService(input, now) {
    if (input.plan === 'api') {
      return {
        ok: false, notApplicable: true,
        errors: [{ field: 'plan', msg: 'API billing has no session/weekly window — this tool doesn’t apply.' }]
      };
    }
    const errors = [];
    const notes = [];
    const fail = (field, msg) => errors.push({ field: field, msg: msg });

    const sPct = parsePct(input.sessionPct);
    const wPct = parsePct(input.weeklyPct);
    if (blank(input.sessionPct)) fail('sessionPct', 'Session % is empty.');
    else if (!(sPct <= 100)) fail('sessionPct', 'Session % must be 0–100.');
    if (blank(input.weeklyPct)) fail('weeklyPct', 'Weekly % is empty.');
    else if (!(wPct <= 100)) fail('weeklyPct', 'Weekly % must be 0–100.');
    const leftMode = input.mode === 'left';
    const sessionLeft = leftMode ? sPct : 100 - sPct;
    const weeklyLeft = leftMode ? wPct : 100 - wPct;

    // 5 小时额度：还有多久重置
    let sessionHours = null;
    let sessionResetBad = false;
    if (input.sessionResetType === 'clock') {
      const c = parseClock(input.sessionClock);
      if (c) sessionHours = hoursUntilClock(c, now);
      else if (!blank(input.sessionClock)) { sessionResetBad = true; fail('sessionClock', 'Resets in must be a clock time.'); }
    } else if (!blank(input.sessionH) || !blank(input.sessionM)) {
      const h = blank(input.sessionH) ? 0 : parseAmount(input.sessionH);
      const m = blank(input.sessionM) ? 0 : parseAmount(input.sessionM);
      if (isNaN(h) || isNaN(m) || m > 59) {
        sessionResetBad = true;
        fail('sessionCountdown', 'Resets in must be hours and minutes.');
      } else {
        sessionHours = h + m / 60;
      }
    }
    if (sessionHours === null && !sessionResetBad && sPct <= 100) {
      if (sessionLeft >= 100) {
        sessionHours = RULES.sessionHours;
        notes.push("Session hasn't started, so this counts as a full 5 hours.");
      } else {
        fail(input.sessionResetType === 'clock' ? 'sessionClock' : 'sessionCountdown',
          'Resets in is empty.');
      }
    }
    if (sessionHours !== null && sessionHours > RULES.sessionHours) {
      notes.push('Session usually resets within 5 hours. This is more than 5 hours away — check AM/PM.');
    }

    // 每周额度：周几、几点重置
    const day = blank(input.weeklyDay) ? NaN : Number(input.weeklyDay);
    const weeklyClock = parseClock(input.weeklyClock);
    if (blank(input.weeklyDay)) fail('weeklyDay', 'Weekday is empty.');
    else if (!(day >= 0 && day <= 6)) fail('weeklyDay', 'Weekday must be a day of the week.');
    if (!blank(input.weeklyClock) && !weeklyClock) fail('weeklyClock', 'Weekly time must look like 08:00.');

    if (errors.length) return { ok: false, errors: errors };

    const weekly = hoursUntilWeekly(day, weeklyClock, now);
    if (weekly.guess === 'today') {
      notes.push('Weekly resets today and no time was entered, so this counts as resetting now. Small at most. Add a time for a better fit.');
    } else if (weekly.guess === 'midnight') {
      notes.push('No weekly time, so this uses ' + WEEKDAYS[day] + ' at midnight (the earliest case).');
    }

    const effective = Math.min(sessionLeft, weeklyLeft);
    const bottleneck = sessionLeft < weeklyLeft ? 'session' : weeklyLeft < sessionLeft ? 'weekly' : 'both';
    const nearest = sessionHours <= weekly.hours
      ? { which: 'session', hours: sessionHours }
      : { which: 'weekly', hours: weekly.hours };

    // 先按百分比定档，再按离每周额度重置的时间往下压（只会压小，不会抬大）
    const baseBand = bandFromRemaining(effective);
    const cap = weeklyTimeCap(weekly.hours);
    let band = baseBand;
    let timeCapped = false;
    if (rank(baseBand) > rank(cap)) {
      band = cap;
      timeCapped = true;
    }
    // 卡在 5 小时额度、它又马上重置：档位照规格算，只提醒重置后可能变大
    if (band !== 'none' && bottleneck === 'session' && sessionHours < RULES.sessionSoonHours) {
      const capped = bandFromRemaining(weeklyLeft);
      const after = rank(capped) > rank(cap) ? cap : capped;
      if (rank(after) > rank(band)) {
        notes.push('Limited by Session, which ' +
          (Math.round(sessionHours * 60) <= 0 ? 'resets any moment' : 'resets in ' + formatHours(sessionHours)) +
          '. Calculate again after it resets — it could be ' + BAND_INFO[after].label + '.');
      }
    }

    // 用完了：哪个用完等哪个；两个都用完，要等每周额度
    let waitFor = null;
    if (baseBand === 'none') {
      waitFor = weeklyLeft <= 0
        ? { which: 'weekly', hours: weekly.hours }
        : { which: 'session', hours: sessionHours };
    }

    return {
      ok: true,
      sessionLeft: sessionLeft, weeklyLeft: weeklyLeft, effective: effective, bottleneck: bottleneck,
      sessionHours: sessionHours, weeklyHours: weekly.hours, nearest: nearest,
      baseBand: baseBand, weeklyCap: cap, band: band, timeCapped: timeCapped, waitFor: waitFor, notes: notes
    };
  }

  // ---------------- 推荐：先按档位过滤，再按偏好排序 ----------------

  // 用户写的字里第一个出现的词；没有 → ''
  function firstHit(text, words) {
    if (!text) return '';
    const t = text.toLowerCase();
    return (words || []).find(w => t.indexOf(w.toLowerCase()) !== -1) || '';
  }

  function labelIn(list, id) {
    const d = (list || []).find(x => x.id === id);
    return d ? d.label : id;
  }

  function domainLabel(id) { return labelIn(QP.DOMAINS, id); }

  // 每一种偏好对上了加几分。「想做的事」命中项目关键词最具体，8 分，
  // 比其他几项全对上（3 + 2 + 1 = 6）还高，所以命中的项目一定排最前。
  const WEIGHTS = { wish: 8, domain: 3, output: 2, audience: 1, inferred: 1 };

  function bandReason(projectBand, userBand) {
    const mine = BAND_INFO[userBand].label;
    const its = BAND_INFO[projectBand].label;
    return projectBand === userBand
      ? 'Fits your ' + mine + ' band.'
      : "Smaller than what's left (" + its + ').';
  }

  // 问卷回答 → 统一的偏好。只认列表里有的选项，乱写的 id 一律忽略。
  function readPrefs(opts, domainList) {
    const pickIds = (ids, list) => new Set((Array.isArray(ids) ? ids : []).filter(id => (list || []).some(x => x.id === id)));
    const wish = String(opts.wish || '').trim();
    const other = String(opts.otherDomain || '').trim();
    const prefs = {
      wish: wish, other: other, text: (wish + ' ' + other).trim(),
      domains: pickIds(opts.domains, domainList),
      outputs: pickIds(opts.outputs, QP.OUTPUTS),
      audiences: pickIds(opts.audiences, QP.AUDIENCES),
      inferred: {} // 从「其他」和「想做的事」里认出来的领域 → 认出它的那个词
    };
    domainList.forEach(d => {
      const w = firstHit(other, d.words) || firstHit(wish, d.words);
      if (w) prefs.inferred[d.id] = w;
    });
    prefs.personalized = prefs.text !== '' || prefs.domains.size + prefs.outputs.size + prefs.audiences.size > 0;
    return prefs;
  }

  // 一个项目和偏好对上了哪几点；每一点都写成一句人话，卡片上照着显示
  function matchProject(p, prefs) {
    const matches = [];
    let score = 0;
    const kw = firstHit(prefs.text, p.keywords);
    if (kw) {
      score += WEIGHTS.wish;
      matches.push('You mentioned \u201c' + kw + '\u201d.');
    }
    if (prefs.domains.has(p.domain)) {
      score += WEIGHTS.domain;
      matches.push('You picked “' + domainLabel(p.domain) + '”.');
    } else if (prefs.inferred[p.domain] && prefs.inferred[p.domain] !== kw) { // same word is not counted twice
      score += WEIGHTS.inferred;
      matches.push('You wrote “' + prefs.inferred[p.domain] + '”, related to ' + domainLabel(p.domain) + '.');
    }
    const outs = (p.outputs || []).filter(id => prefs.outputs.has(id));
    if (outs.length) {
      score += WEIGHTS.output;
      matches.push('You want “' + outs.map(id => labelIn(QP.OUTPUTS, id)).join('”, “') + '”.');
    }
    const aud = (p.audience || []).filter(id => prefs.audiences.has(id));
    if (aud.length) {
      score += WEIGHTS.audience;
      matches.push('You picked “' + aud.map(id => labelIn(QP.AUDIENCES, id)).join('”, “') + '”.');
    }
    return { score: score, matches: matches };
  }

  const NO_PREFS = 'Listed by band only.';
  const NO_MATCH = "Band fits; your preferences don't.";

  // 用户自己写的「最近想做的事」，按档位做成一张项目卡
  function customProject(wish, band) {
    // Strip trailing punctuation so the prompt doesn't end with "..".
    // A wish that already starts with "I want" / "Want" is not prefixed again.
    const what = wish.replace(/[\s。．.！!？?，,；;、…~～]+$/u, '') || wish;
    let say = what;
    if (/^i\s+want\b/i.test(what)) say = what;
    else if (/^want\b/i.test(what)) say = 'I ' + what.charAt(0).toLowerCase() + what.slice(1);
    else say = 'I want to: ' + what;
    const short = what.length > 30 ? what.slice(0, 30) + '…' : what;
    const T = {
      small: {
        title: 'Get “' + short + '” clear first',
        output: 'One page: the few things to do, the order, and a first step you can take today.',
        steps: [
          'Send this to the AI: “' + say + '. Ask me 3 questions first so you understand my situation, then help me sort it out.”',
          'Answer the questions.',
          'Ask for one page. The first step should be something you can do today.'
        ],
        done: 'One page, with a first step you can start today.'
      },
      medium: {
        title: 'Make a first piece of “' + short + '”',
        output: 'A short plan, plus a first piece (a paragraph, a table, or a draft).',
        steps: [
          'Send this to the AI: “' + say + '. Ask me a few questions, then break this into steps.”',
          'Answer, and have it split the work into 3–5 steps. Each step says what “done” looks like.',
          'Do the first step with it, in this sitting.',
          'Check the result against your real situation and ask for fixes.'
        ],
        done: 'A step-by-step plan plus a first piece.'
      },
      large: {
        title: 'Finish “' + short + '”',
        output: 'One finished piece: writing, a table, or a plan you can use as-is.',
        steps: [
          'Send this to the AI: “' + say + '. Ask me a few questions so we know what finished looks like.”',
          'Ask for an outline and say which parts to keep.',
          'Do it one part at a time. Pause and come back if you need to.',
          'Read the whole thing, ask it to find problems, and revise once.',
          'Ask for a short list of what is still left.'
        ],
        done: 'One finished piece you can use, share, or print.'
      }
    };
    return Object.assign({ id: 'custom:' + wish, domain: 'custom', band: band, custom: true }, T[band]);
  }

  /*
   * opts: {
   *   band, done: [做完的项目 id],
   *   偏好（全都可以不填）：domains: [领域 id], otherDomain, wish, outputs: [成果 id], audiences: [给谁 id],
   *   projects?, domainList?（测试用）
   * }
   * 返回 {
   *   cards: 这一档、跟偏好对上的项目，按对上的分数排好（含按「想做的事」现做的那张）,
   *   others: 这一档、跟偏好没对上的项目（只在填了偏好时有）,
   *   smaller: 比这一档小的项目（可选做）,
   *   fallback: 填了偏好，但这一档一个都没对上，改为列出这一档全部,
   *   personalized: 填了任何一项偏好
   * }
   * 每张卡多一个 why：{ band: 档位理由, matches: [对上的偏好], summary: 没对上时的说明, score }
   * 顺序固定：先按档位过滤（只留 ≤ band 的），再按偏好排序。绝不推超过剩余的。
   */
  function recommend(opts) {
    const band = opts.band;
    const empty = { cards: [], others: [], smaller: [], fallback: false, personalized: false };
    if (!(rank(band) > 0)) return empty;

    const projects = opts.projects || QP.PROJECTS;
    const domainList = opts.domainList || QP.DOMAINS;
    const done = opts.done || [];
    const prefs = readPrefs(opts, domainList);

    // 第 1 步：按档位过滤。只留不超过当前档、还没做完的。
    const pool = projects.filter(p => done.indexOf(p.id) === -1 && rank(p.band) > 0 && rank(p.band) <= rank(band));

    // 第 2 步：按偏好打分。不改项目库本身，复制一份再挂上 why。
    const scored = pool.map(p => {
      const m = matchProject(p, prefs);
      return Object.assign({}, p, {
        why: {
          band: bandReason(p.band, band), matches: m.matches, score: m.score,
          summary: m.matches.length ? '' : prefs.personalized ? NO_MATCH : NO_PREFS
        }
      });
    });
    // sort 是稳定的：同分的保持项目库里的顺序
    const byScore = (a, b) => b.why.score - a.why.score;

    const exact = scored.filter(p => p.band === band);
    let cards = prefs.personalized ? exact.filter(p => p.why.score > 0).sort(byScore) : exact;
    let others = prefs.personalized ? exact.filter(p => p.why.score === 0) : [];
    let fallback = false;
    if (prefs.personalized && !cards.length) {
      cards = others;
      others = [];
      fallback = true;
    }

    // 按「想做的事」现做的卡：排在关键词命中的项目后面、其他项目前面
    if (prefs.wish) {
      const mine = customProject(prefs.wish, band);
      if (done.indexOf(mine.id) === -1) {
        mine.why = {
          band: bandReason(band, band), score: WEIGHTS.wish, summary: '',
          matches: ['Built from what you wrote: “' + (prefs.wish.length > 30 ? prefs.wish.slice(0, 30) + '…' : prefs.wish) + '”.']
        };
        const at = cards.filter(p => p.why.score >= WEIGHTS.wish).length;
        cards = cards.slice(0, at).concat([mine], cards.slice(at));
      }
    }

    const smaller = scored
      .filter(p => rank(p.band) < rank(band) && (!prefs.personalized || p.why.score > 0))
      .sort((a, b) => rank(b.band) - rank(a.band) || byScore(a, b));

    return { cards: cards, others: others, smaller: smaller, fallback: fallback, personalized: prefs.personalized };
  }

  QP.core = {
    BANDS: BANDS, BAND_INFO: BAND_INFO, RULES: RULES, WEEKDAYS: WEEKDAYS, WINDOW_NAME: WINDOW_NAME, WEIGHTS: WEIGHTS,
    rank: rank, bandFromRemaining: bandFromRemaining, weeklyTimeCap: weeklyTimeCap,
    parsePct: parsePct, parseClock: parseClock,
    hoursUntilClock: hoursUntilClock, hoursUntilWeekly: hoursUntilWeekly,
    formatHours: formatHours, formatUntil: formatUntil,
    computeService: computeService,
    domainLabel: domainLabel, customProject: customProject, recommend: recommend
  };
})();
