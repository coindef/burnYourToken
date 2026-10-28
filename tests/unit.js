/* 单元测试：只测 js/core.js 和 js/projects.js，不碰页面。 */
(function () {
  'use strict';
  const C = QP.core;
  // 固定「现在」：2026-07-13 周一 10:00（本地时间）。选七月是为了避开各地夏令时切换，
  // 不然「下周一 9 点」会差出 1 小时（那是对的，但测试不好写死）。
  const NOW = new Date(2026, 6, 13, 10, 0, 0);

  // 默认：5 小时额度 3 小时后重置；每周额度周四 08:00 重置（离现在 70 小时）
  function input(over) {
    return Object.assign({
      plan: 'pro', mode: 'used',
      sessionPct: '0', sessionResetType: 'countdown', sessionH: '3', sessionM: '0', sessionClock: '',
      weeklyPct: '0', weeklyDay: '4', weeklyClock: '08:00'
    }, over);
  }
  const calc = over => C.computeService(input(over), NOW);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const fields = r => (r.errors || []).map(e => e.field);

  // 用「还剩」填，读起来直接对上规格：left(60, 60, '2', '10:00') = 两个都剩 60%，周二 10:00 重置（正好 24 小时后）
  const left = (s, w, day, clock) => calc({ mode: 'left', sessionPct: String(s), weeklyPct: String(w), weeklyDay: day || '4', weeklyClock: clock || '08:00' });

  // ---------------- 计算器：已定的档位规格 ----------------
  // 大 = 两个窗口都 > 50% 且离每周重置 > 1 天；中 = 任一窗口 20%–50%；小 = 任一窗口 < 20% 或离每周重置只剩几小时（< 5 小时）

  test('规格表：每一条规则、每一处重叠和空档都按定好的来', () => {
    // [5 小时剩余, 每周剩余, 周几, 几点, 期望档位, 说明]（现在是周一 10:00）
    [
      [60, 60, '4', '08:00', 'large', '都 > 50%，离每周重置 70 小时'],
      [51, 99, '4', '08:00', 'large', '51% 也算 > 50%'],
      [50, 90, '4', '08:00', 'medium', '正好 50% 不算 > 50%，是中'],
      [90, 50, '4', '08:00', 'medium', '每周正好 50% 也是中'],
      [20, 90, '4', '08:00', 'medium', '正好 20% 是中'],
      [19.9, 90, '4', '08:00', 'small', '不到 20% 是小'],
      [90, 10, '4', '08:00', 'small', '每周不到 20% 也是小'],
      [30, 10, '4', '08:00', 'small', '一个中、一个小 → 取小'],
      [60, 60, '2', '10:00', 'medium', '都 > 50%，但每周正好 24 小时后重置 → 不到「> 1 天」，中'],
      [60, 60, '2', '10:01', 'large', '24 小时 1 分钟 → 大'],
      [60, 60, '1', '15:00', 'medium', '离每周重置正好 5 小时 → 不算「只剩几小时」，中'],
      [60, 60, '1', '14:59', 'small', '4 小时 59 分 → 只剩几小时，小'],
      [30, 30, '1', '14:00', 'small', '中，但离每周重置 4 小时 → 小'],
      [30, 30, '1', '20:00', 'medium', '中，离每周重置 10 小时 → 中'],
      [10, 10, '2', '10:01', 'small', '小的就是小，时间再多也不往大了算']
    ].forEach(c => {
      const r = left(c[0], c[1], c[2], c[3]);
      ok(r.ok, c[5] + ' 应该算得出来');
      eq(r.band, c[4], c[5]);
    });
  });

  test('题目示例 1：5 小时已用 80%（剩 20%）、周已用 30% → 中档（20% 算中），卡在 5 小时额度', () => {
    const r = calc({ sessionPct: '80', weeklyPct: '30' });
    ok(r.ok, '应该算得出来');
    eq(r.sessionLeft, 20, '5 小时剩余');
    eq(r.weeklyLeft, 70, '每周剩余');
    eq(r.effective, 20, '有效剩余');
    eq(r.bottleneck, 'session', '瓶颈');
    eq(r.band, 'medium', '档位');
    eq(r.timeCapped, false, '不是因为时间');
    eq(calc({ sessionPct: '81', weeklyPct: '30' }).band, 'small', '已用 81%（剩 19%）→ 小档');
  });

  test('题目示例 2：两个窗口都剩一半以上、离每周重置 70 小时 → 大档', () => {
    const r = calc({ sessionPct: '30', weeklyPct: '40' });
    eq(r.effective, 60, '有效剩余');
    eq(r.band, 'large', '档位');
    eq(r.weeklyCap, 'large', '时间不压档');
  });

  test('离每周额度重置很近（30 分钟后）→ 只能小档，并标明是时间压的', () => {
    const r = calc({ sessionPct: '10', weeklyPct: '10', weeklyDay: '1', weeklyClock: '10:30' });
    ok(near(r.weeklyHours, 0.5), '还有半小时');
    eq(r.baseBand, 'large', '按剩余本来是');
    eq(r.band, 'small', '最后');
    eq(r.timeCapped, true, '因为时间被压');
  });

  test('离每周额度重置不到 1 天 → 大档压成中档，并标明是时间压的', () => {
    const r = left(90, 90, '2', '08:00'); // 22 小时后
    eq(r.baseBand, 'large', '按剩余本来是');
    eq(r.weeklyCap, 'medium', '时间上限');
    eq(r.band, 'medium', '最后');
    eq(r.timeCapped, true, '因为时间被压');
  });

  test('5 小时额度的重置时间不再压档：它 20 分钟后就重置，两个都剩 90% → 还是大档', () => {
    const r = calc({ sessionPct: '10', weeklyPct: '10', sessionH: '0', sessionM: '20' });
    eq(r.band, 'large', '档位');
    eq(r.timeCapped, false, '没被压');
    eq(r.nearest.which, 'session', '最近的重置还是记着');
  });

  test('卡在 5 小时额度、它 1 小时内重置 → 档位照算，另外提醒重置后再算（可能变大）', () => {
    const r = calc({ sessionPct: '70', weeklyPct: '10', sessionH: '0', sessionM: '20' }); // 剩 30% / 90%
    eq(r.band, 'medium', '照规格还是中');
    ok(r.notes.some(n => n.indexOf('20 分钟就重置') !== -1 && n.indexOf('可能就是大档') !== -1), '有提醒：' + r.notes.join(' / '));
    const far = calc({ sessionPct: '70', weeklyPct: '10', sessionH: '2', sessionM: '0' });
    ok(!far.notes.some(n => n.indexOf('可能就是') !== -1), '还有 2 小时才重置 → 不提醒');
    const weeklyNeck = calc({ sessionPct: '10', weeklyPct: '70', sessionH: '0', sessionM: '20' });
    ok(!weeklyNeck.notes.some(n => n.indexOf('可能就是') !== -1), '卡在每周额度 → 不提醒');
    const capped = calc({ sessionPct: '70', weeklyPct: '10', sessionH: '0', sessionM: '20', weeklyDay: '1', weeklyClock: '12:00' });
    eq(capped.band, 'small', '离每周重置 2 小时 → 小');
    ok(!capped.notes.some(n => n.indexOf('可能就是') !== -1), '重置 5 小时额度也变不大 → 不提醒');
  });

  test('有效剩余 40% → 中档', () => {
    const r = calc({ sessionPct: '60', weeklyPct: '20' });
    eq(r.effective, 40, '有效剩余');
    eq(r.band, 'medium', '档位');
  });

  test('瓶颈在每周额度时，标成卡在每周额度', () => {
    const r = calc({ sessionPct: '10', weeklyPct: '90' });
    eq(r.bottleneck, 'weekly', '瓶颈');
    eq(r.band, 'small', '档位');
  });

  test('只看百分比的分档边界：50.1 大、50 中、20 中、19.9 小、0.1 小、0 无', () => {
    eq(C.bandFromRemaining(100), 'large');
    eq(C.bandFromRemaining(50.1), 'large');
    eq(C.bandFromRemaining(50), 'medium');
    eq(C.bandFromRemaining(20), 'medium');
    eq(C.bandFromRemaining(19.9), 'small');
    eq(C.bandFromRemaining(0.1), 'small');
    eq(C.bandFromRemaining(0), 'none');
    eq(C.bandFromRemaining(-5), 'none');
    eq(C.bandFromRemaining(NaN), 'none');
  });

  test('只看时间的上限：不到 5 小时 → 小；5 小时到 1 天 → 中；超过 1 天 → 大', () => {
    eq(C.weeklyTimeCap(0), 'small');
    eq(C.weeklyTimeCap(4.99), 'small');
    eq(C.weeklyTimeCap(5), 'medium');
    eq(C.weeklyTimeCap(24), 'medium');
    eq(C.weeklyTimeCap(24.01), 'large');
    eq(C.weeklyTimeCap(167), 'large');
  });

  test('每周额度用完 → 没有剩余，等每周额度重置', () => {
    const r = calc({ sessionPct: '10', weeklyPct: '100' });
    eq(r.band, 'none', '档位');
    eq(r.waitFor.which, 'weekly', '等哪个');
    ok(near(r.waitFor.hours, 70), '还有 70 小时');
  });

  test('5 小时额度用完、每周还有 → 等 5 小时额度重置', () => {
    const r = calc({ sessionPct: '100', weeklyPct: '50' });
    eq(r.band, 'none', '档位');
    eq(r.waitFor.which, 'session', '等哪个');
    ok(near(r.waitFor.hours, 3), '还有 3 小时');
  });

  test('用量页写的是「还剩」：还剩 19% / 70% → 小档；还剩 20% → 中档', () => {
    const r = calc({ mode: 'left', sessionPct: '19', weeklyPct: '70' });
    eq(r.effective, 19, '有效剩余');
    eq(r.band, 'small', '档位');
    eq(calc({ mode: 'left', sessionPct: '20', weeklyPct: '70' }).band, 'medium', '20%');
  });

  test('5 小时额度还没开始用、没填重置时间 → 按整整 5 小时算', () => {
    const r = calc({ sessionPct: '0', sessionH: '', sessionM: '' });
    ok(r.ok, '应该算得出来');
    eq(r.sessionHours, 5, '5 小时');
    eq(r.band, 'large', '档位');
    ok(r.notes.some(n => n.indexOf('还没开始用') !== -1), '有说明');
  });

  test('用了一部分却没填重置时间 → 提示要填', () => {
    const r = calc({ sessionPct: '40', sessionH: '', sessionM: '' });
    eq(r.ok, false, '算不出来');
    ok(fields(r).indexOf('sessionCountdown') !== -1, '指向倒计时输入框');
  });

  test('空着和填错分开说，并写明是第几个数', () => {
    const blank = calc({ sessionPct: '', weeklyPct: '', sessionH: '', sessionM: '', weeklyDay: '' });
    const msgs = blank.errors.map(e => e.msg).join('\n');
    ok(msgs.indexOf('①') !== -1 && msgs.indexOf('还空着') !== -1, msgs);
    ok(msgs.indexOf('③') !== -1 && msgs.indexOf('周几还没选') !== -1, msgs);
    ok(msgs.indexOf('不是 0 到 100') === -1, '空着不当成填错：' + msgs);
    const bad = calc({ sessionPct: '150', weeklyPct: 'nope' });
    const badMsgs = bad.errors.map(e => e.msg).join('\n');
    ok(badMsgs.indexOf('①') !== -1 && badMsgs.indexOf('③') !== -1 && badMsgs.indexOf('不是 0 到 100') !== -1, badMsgs);
    ok(badMsgs.indexOf('还空着') === -1, badMsgs);
    const noReset = calc({ sessionPct: '40', sessionH: '', sessionM: '' });
    ok(noReset.errors.some(e => e.field === 'sessionCountdown' && e.msg.indexOf('②') !== -1 && e.msg.indexOf('还空着') !== -1), noReset.errors.map(e => e.msg).join(' / '));
  });

  test('百分比不合法会报错；带 % 号和小数可以', () => {
    ok(fields(calc({ sessionPct: '120' })).indexOf('sessionPct') !== -1, '120');
    ok(fields(calc({ sessionPct: 'abc' })).indexOf('sessionPct') !== -1, 'abc');
    ok(fields(calc({ weeklyPct: '' })).indexOf('weeklyPct') !== -1, '空的');
    ok(fields(calc({ weeklyPct: '-3' })).indexOf('weeklyPct') !== -1, '负数');
    eq(calc({ sessionPct: '80%' }).effective, 20, '80%');
    eq(calc({ sessionPct: '80.5' }).effective, 19.5, '80.5');
    eq(calc({ sessionPct: ' 80 ' }).effective, 20, '前后有空格');
  });

  test('没选周几 / 时间格式不对 / 分钟超过 59 → 报错', () => {
    ok(fields(calc({ weeklyDay: '' })).indexOf('weeklyDay') !== -1, '没选周几');
    ok(fields(calc({ weeklyClock: '25:00' })).indexOf('weeklyClock') !== -1, '25:00');
    ok(fields(calc({ sessionH: '1', sessionM: '75' })).indexOf('sessionCountdown') !== -1, '75 分钟');
    ok(fields(calc({ sessionH: '一', sessionM: '' })).indexOf('sessionCountdown') !== -1, '汉字');
    ok(fields(calc({ sessionResetType: 'clock', sessionClock: 'abc' })).indexOf('sessionClock') !== -1, '钟点乱填');
  });

  test('中文输入法打出的全角数字和符号也认：８０、８０％、８：００、2.5 小时、.5', () => {
    eq(calc({ sessionPct: '８０', weeklyPct: '３０％' }).effective, 20, '全角百分比');
    eq(calc({ sessionPct: '80 %' }).effective, 20, '数字和 % 中间有空格');
    ok(calc({ weeklyClock: '０８：００' }).ok, '全角钟点');
    ok(near(calc({ sessionPct: '10', sessionH: '2.5', sessionM: '' }).sessionHours, 2.5), '2.5 小时');
    ok(near(calc({ sessionPct: '10', sessionH: '２', sessionM: '３０' }).sessionHours, 2.5), '全角 2 小时 30 分');
    eq(calc({ sessionPct: '.5' }).effective, 99.5, '.5');
  });

  test('已经到点时，不写「还有 马上就到」这种话', () => {
    eq(C.formatUntil(0), '马上就要重置了');
    eq(C.formatUntil(3), '还有 3 小时');
    const r = calc({ sessionPct: '100', weeklyPct: '50', sessionH: '0', sessionM: '0' });
    eq(r.band, 'none');
    eq(C.formatUntil(r.waitFor.hours), '马上就要重置了');
  });

  test('按 API 用量付钱 → 不适用', () => {
    const r = calc({ plan: 'api' });
    eq(r.ok, false);
    eq(r.notApplicable, true);
  });

  test('填钟点：5 小时额度 10:30 重置（半小时后）→ 算对时间，档位不受影响；09:00 → 算明天，并提醒可能抄错', () => {
    const a = calc({ sessionResetType: 'clock', sessionClock: '10:30', sessionPct: '10', weeklyPct: '10' });
    ok(near(a.sessionHours, 0.5), '半小时');
    eq(a.band, 'large', '档位');
    const w = calc({ weeklyDay: '1', weeklyClock: '10:30', sessionPct: '10', weeklyPct: '10' });
    eq(w.band, 'small', '每周额度 10:30 重置 → 小档');
    const b = calc({ sessionResetType: 'clock', sessionClock: '09:00', sessionPct: '10', weeklyPct: '10' });
    ok(near(b.sessionHours, 23), '23 小时');
    ok(b.notes.some(n => n.indexOf('超过了 5 小时') !== -1), '有提醒');
  });

  test('每周重置时间：已过的今天 → 下周；今天没填几点 → 按马上重置；别的天没填几点 → 那天 0 点', () => {
    const passed = C.hoursUntilWeekly(1, { h: 9, m: 0 }, NOW);
    ok(near(passed.hours, 167), '周一 09:00 已过 → 167 小时');
    const later = C.hoursUntilWeekly(1, { h: 11, m: 0 }, NOW);
    ok(near(later.hours, 1), '周一 11:00 → 1 小时');
    const todayUnknown = C.hoursUntilWeekly(1, null, NOW);
    eq(todayUnknown.hours, 0, '今天没填几点');
    eq(todayUnknown.guess, 'today');
    const wed = C.hoursUntilWeekly(3, null, NOW);
    ok(near(wed.hours, 38), '周三 0 点 → 38 小时');
    const sun = C.hoursUntilWeekly(0, { h: 20, m: 0 }, NOW);
    ok(near(sun.hours, 154), '周日 20:00 → 154 小时');
    const r = calc({ sessionPct: '10', weeklyPct: '10', weeklyDay: '1', weeklyClock: '' });
    eq(r.band, 'small', '今天重置但没填几点 → 小档');
    ok(r.notes.some(n => n.indexOf('今天重置') !== -1), '有说明');
  });

  test('时长显示', () => {
    eq(C.formatHours(0), '马上就到');
    eq(C.formatHours(0.5), '30 分钟');
    eq(C.formatHours(3), '3 小时');
    eq(C.formatHours(3.25), '3 小时 15 分钟');
    eq(C.formatHours(48), '2 天');
    eq(C.formatHours(70), '2 天 22 小时');
  });

  test('两个服务各算各的：同一时刻两份输入，结果互不影响', () => {
    const claude = calc({ sessionPct: '85', weeklyPct: '30' });
    const gpt = calc({ plan: 'plus', sessionPct: '10', weeklyPct: '20' });
    eq(claude.band, 'small', 'Claude');
    eq(gpt.band, 'large', 'ChatGPT');
    eq(claude.effective, 15, 'Claude 的有效剩余不受 ChatGPT 影响');
  });

  // ---------------- 项目库 ----------------

  test('项目库：至少 12 个项目、至少 6 个领域，四个字段都齐，id 不重复', () => {
    const P = QP.PROJECTS;
    ok(P.length >= 12, '项目数 ' + P.length);
    const domains = new Set(P.map(p => p.domain));
    ok(domains.size >= 6, '领域数 ' + domains.size);
    eq(new Set(P.map(p => p.id)).size, P.length, 'id 不重复');
    P.forEach(p => {
      ok(['small', 'medium', 'large'].indexOf(p.band) !== -1, p.id + ' 档位');
      ok(QP.DOMAINS.some(d => d.id === p.domain), p.id + ' 领域');
      ok(p.title && p.output && p.done, p.id + ' 标题/目标产出/验收标准');
      ok(Array.isArray(p.steps) && p.steps.length >= 3, p.id + ' 至少 3 步');
      ok(Array.isArray(p.keywords) && p.keywords.length, p.id + ' 关键词');
    });
  });

  test('每个领域 × 每个档位都至少有 1 个项目', () => {
    QP.DOMAINS.forEach(d => ['small', 'medium', 'large'].forEach(b => {
      ok(QP.PROJECTS.some(p => p.domain === d.id && p.band === b), d.label + ' × ' + b);
    }));
  });

  test('偏好标签：每个项目都标了成果和给谁，标签都在问卷选项里', () => {
    const outIds = QP.OUTPUTS.map(o => o.id);
    const audIds = QP.AUDIENCES.map(a => a.id);
    eq(new Set(outIds).size, outIds.length, '成果 id 不重复');
    eq(new Set(audIds).size, audIds.length, '给谁 id 不重复');
    QP.PROJECTS.forEach(p => {
      ok(Array.isArray(p.outputs) && p.outputs.length, p.id + ' 有成果标签');
      ok(Array.isArray(p.audience) && p.audience.length, p.id + ' 有给谁标签');
      p.outputs.forEach(id => ok(outIds.indexOf(id) !== -1, p.id + ' 成果 ' + id));
      p.audience.forEach(id => ok(audIds.indexOf(id) !== -1, p.id + ' 给谁 ' + id));
    });
  });

  test('每个档位 × 每种成果、每个档位 × 每种「给谁」都至少有 1 个项目（选哪个都对得上）', () => {
    ['small', 'medium', 'large'].forEach(b => {
      QP.OUTPUTS.forEach(o => ok(QP.PROJECTS.some(p => p.band === b && p.outputs.indexOf(o.id) !== -1), b + ' × ' + o.label));
      QP.AUDIENCES.forEach(a => ok(QP.PROJECTS.some(p => p.band === b && p.audience.indexOf(a.id) !== -1), b + ' × ' + a.label));
    });
  });

  test('研究、摘要类只占一小块；学习类也不是大头（不只给学生）', () => {
    const P = QP.PROJECTS;
    const researchy = P.filter(p => /研究|报告|摘要|总结|看懂|比较|调研/.test(p.title));
    ok(researchy.length <= 3 && researchy.length / P.length <= 0.2, '研究/摘要类 ' + researchy.length + ' 个');
    const study = P.filter(p => p.domain === 'study');
    ok(study.length / P.length <= 0.25, '学习类 ' + study.length + ' 个');
    const studentOnly = P.filter(p => /学生|论文|课堂|老师布置/.test(p.title + p.output));
    eq(studentOnly.length, 0, '只适合学生的项目');
  });

  // ---------------- 推荐 ----------------

  test('绝不推超过档位的项目（穷举 3 个档位 × 128 种领域组合 × 3 种想做的事 × 有没有做完的）', () => {
    const ids = QP.DOMAINS.map(d => d.id);
    let checked = 0;
    ['small', 'medium', 'large'].forEach(band => {
      for (let mask = 0; mask < 1 << ids.length; mask++) {
        const domains = ids.filter((_, i) => mask & (1 << i));
        ['', '想去日本旅游', '<img src=x onerror=alert(1)>'].forEach(wish => {
          [[], ['travel-trip', 'life-meals', 'work-checklist']].forEach(done => {
            const r = C.recommend({ band: band, domains: domains, wish: wish, done: done });
            r.cards.forEach(p => eq(p.band, band, '主推荐档位'));
            r.smaller.forEach(p => ok(C.rank(p.band) < C.rank(band), '「小一点的」必须更小'));
            r.cards.concat(r.smaller).forEach(p => ok(done.indexOf(p.id) === -1, '不推做完的'));
            ok(r.cards.length > 0, '总有东西推：' + band + ' ' + domains.join(','));
            checked++;
          });
        });
      }
    });
    ok(checked === 3 * 128 * 3 * 2, '组合数 ' + checked);
  });

  test('先按档位过滤、再按偏好排序：穷举 3 档 × 128 种领域 × 32 种成果 × 8 种给谁（共 98304 组），没有一张超档，排序和理由都对', () => {
    const dIds = QP.DOMAINS.map(d => d.id);
    const oIds = QP.OUTPUTS.map(o => o.id);
    const aIds = QP.AUDIENCES.map(a => a.id);
    const wishes = ['', '想减肥', '带爸妈去云南'];
    const dones = [[], ['travel-trip', 'life-meals', 'work-checklist', 'create-posts']];
    const subset = (ids, mask) => ids.filter((_, i) => mask & (1 << i));
    let checked = 0;
    let bad = '';
    const fail = msg => { if (!bad) bad = msg; };
    ['small', 'medium', 'large'].forEach(band => {
      for (let dm = 0; dm < 1 << dIds.length; dm++) {
        for (let om = 0; om < 1 << oIds.length; om++) {
          for (let am = 0; am < 1 << aIds.length; am++) {
            const n = checked++;
            const opts = {
              band: band, domains: subset(dIds, dm), outputs: subset(oIds, om), audiences: subset(aIds, am),
              wish: wishes[n % 3], done: dones[n % 2]
            };
            const r = C.recommend(opts);
            const where = () => ' @ ' + JSON.stringify(opts);
            if (!r.cards.length) fail('没东西推' + where());
            r.cards.concat(r.others).forEach(p => { if (p.band !== band) fail('主推荐 / 同档其他超档或降档：' + p.id + where()); });
            r.smaller.forEach(p => { if (!(C.rank(p.band) < C.rank(band))) fail('「小一点的」不小：' + p.id + where()); });
            r.cards.concat(r.others, r.smaller).forEach(p => {
              if (opts.done.indexOf(p.id) !== -1) fail('推了做完的：' + p.id + where());
              if (!p.why || !p.why.band || !(p.why.matches.length || p.why.summary)) fail('没写为什么推：' + p.id + where());
            });
            const real = r.cards.filter(p => !p.custom);
            for (let i = 1; i < real.length; i++) {
              if (real[i - 1].why.score < real[i].why.score) fail('没按分数排：' + real[i].id + where());
            }
            if (r.personalized && !r.fallback) {
              real.forEach(p => { if (!(p.why.score > 0 && p.why.matches.length)) fail('没对上的混进主推荐：' + p.id + where()); });
              r.others.forEach(p => { if (p.why.score !== 0) fail('对上的被放进「其他」：' + p.id + where()); });
            }
          }
        }
      }
    });
    eq(bad, '', '第一处出错');
    eq(checked, 3 * 128 * 32 * 8, '组合数');
  });

  test('没有剩余（none）→ 一个都不推', () => {
    const r = C.recommend({ band: 'none', domains: ['travel'], wish: '旅游', outputs: ['plan'], audiences: ['family'] });
    eq(r.cards.length, 0);
    eq(r.others.length, 0);
    eq(r.smaller.length, 0);
  });

  test('偏好排序：旅行 + 一份计划 + 给家人（中档）→ 对上 3 点的排第一，分数从高到低，没对上的放进「其他」', () => {
    const r = C.recommend({ band: 'medium', domains: ['travel'], outputs: ['plan'], audiences: ['family'] });
    const ids = r.cards.map(p => p.id);
    eq(ids[0], 'travel-day-trip', '第一张');
    eq(r.cards[0].why.matches.length, 3, '对上 3 点：' + r.cards[0].why.matches.join(' / '));
    eq(ids[1], 'hobby-party', '第二张：计划 + 给家人');
    ok(r.cards.every(p => p.why.score > 0), '主推荐都对上了');
    ok(r.others.length > 0 && r.others.every(p => p.why.score === 0 && p.band === 'medium'), '其他同档');
    eq(r.cards.length + r.others.length, QP.PROJECTS.filter(p => p.band === 'medium').length, '同档一个不少');
    ok(r.cards[0].why.matches.some(t => t.indexOf('旅行') !== -1), '理由里写了领域');
    ok(r.cards[0].why.matches.some(t => t.indexOf('一份计划或方案') !== -1), '理由里写了成果');
    ok(r.cards[0].why.matches.some(t => t.indexOf('给家人、朋友或孩子') !== -1), '理由里写了给谁');
  });

  test('偏好不同，排序跟着变（同一个档位）', () => {
    const top = o => C.recommend(Object.assign({ band: 'large' }, o)).cards[0].id;
    eq(top({ outputs: ['fun'], audiences: ['family'] }), 'hobby-game', '好玩的 + 给家人');
    eq(top({ outputs: ['text'], audiences: ['family'] }), 'create-memory-book', '文字 + 给家人');
    eq(top({ outputs: ['learn'], audiences: ['work'] }), 'work-job', '练熟 + 工作');
    eq(top({ domains: ['life'], outputs: ['list'] }), 'life-budget', '生活 + 一张表');
    eq(C.recommend({ band: 'small', audiences: ['work'] }).cards[0].id, 'work-message', '小档 + 工作');
  });

  test('「想做的事」命中关键词永远排最前，比其他偏好全对上还靠前', () => {
    const r = C.recommend({ band: 'medium', wish: '想减肥', domains: ['travel'], outputs: ['plan'], audiences: ['family'] });
    eq(r.cards[0].id, 'health-eating', '第一张');
    ok(r.cards[0].why.matches[0].indexOf('减肥') !== -1, '理由先写命中的词');
    eq(r.cards[1].custom, true, '第二张是照你写的事现做的');
    ok(r.cards[1].why.matches[0].indexOf('想减肥') !== -1, '自定义卡也写了为什么');
    eq(r.cards[2].id, 'travel-day-trip', '再往后才是其他偏好对上最多的');
  });

  test('跳过偏好 → 只按档位推：这一档全列出来、按项目库顺序，卡上写明是按档位挑的', () => {
    ['small', 'medium', 'large'].forEach(band => {
      const r = C.recommend({ band: band, domains: [], outputs: [], audiences: [], wish: '  ', otherDomain: '' });
      eq(r.personalized, false, band + ' 没填偏好');
      eq(r.others.length, 0, band + ' 没有「其他」');
      eq(r.cards.map(p => p.id).join(), QP.PROJECTS.filter(p => p.band === band).map(p => p.id).join(), band + ' 全列、库顺序');
      r.cards.forEach(p => {
        eq(p.why.matches.length, 0, p.id + ' 没有对上的偏好');
        ok(p.why.summary.indexOf('只按档位') !== -1, p.id + ' 写明按档位挑');
        ok(p.why.band.indexOf('不会超出你的剩余') !== -1, p.id + ' 写明不超档');
      });
    });
  });

  test('档位理由：同档写「刚好用得上」，小一点的写「比你的剩余小」', () => {
    const r = C.recommend({ band: 'large' });
    ok(r.cards[0].why.band.indexOf('你现在剩的是大档') !== -1 && r.cards[0].why.band.indexOf('刚好用得上') !== -1, r.cards[0].why.band);
    const s = r.smaller.find(p => p.band === 'small');
    ok(s.why.band.indexOf('这个是小档') !== -1 && s.why.band.indexOf('比你的剩余小') !== -1, s.why.band);
  });

  test('坏数据：问卷里不认识的选项 id 一律忽略，不算填了偏好', () => {
    const r = C.recommend({ band: 'medium', domains: ['pets'], outputs: ['hack', null], audiences: 'family' });
    eq(r.personalized, false);
    eq(r.cards.length, QP.PROJECTS.filter(p => p.band === 'medium').length);
  });

  test('推荐不改项目库本身（理由挂在复制出来的卡上）', () => {
    C.recommend({ band: 'large', outputs: ['plan'] });
    ok(QP.PROJECTS.every(p => p.why === undefined), '项目库里没有 why');
  });

  test('选不同领域，推荐跟着变', () => {
    const travel = C.recommend({ band: 'medium', domains: ['travel'] });
    const health = C.recommend({ band: 'medium', domains: ['health'] });
    ok(travel.cards.length && travel.cards.every(p => p.domain === 'travel'), '旅行');
    ok(health.cards.length && health.cards.every(p => p.domain === 'health'), '健康');
    ok(travel.cards[0].id !== health.cards[0].id, '两边不一样');
    const life = C.recommend({ band: 'medium', domains: ['life'] });
    eq(life.cards.map(p => p.id).join(','), 'life-document,life-compare', '生活中档');
  });

  test('没填问卷 → 列出这一档所有领域的项目', () => {
    const r = C.recommend({ band: 'large' });
    eq(r.personalized, false);
    eq(new Set(r.cards.map(p => p.domain)).size, QP.DOMAINS.length, '每个领域都有');
    eq(r.smaller.length, QP.PROJECTS.filter(p => p.band !== 'large').length, '小一点的全列出来');
    ok(C.rank(r.smaller[0].band) >= C.rank(r.smaller[r.smaller.length - 1].band), '小一点的里面先大后小');
  });

  test('想做的事命中关键词 → 排第一，后面跟一张按这件事做的卡', () => {
    const r = C.recommend({ band: 'large', domains: ['work'], wish: '想去日本旅游' });
    eq(r.cards[0].id, 'travel-trip', '第一张');
    eq(r.cards[1].custom, true, '第二张是自定义卡');
    ok(r.cards.some(p => p.id === 'work-job'), '选的领域也在');
  });

  test('写了想做的事 → 多一张同档位的卡，原话保留，太长的标题会截断', () => {
    const wish = '把阳台改造成一个能晒太阳看书的小角落，顺便种点薄荷和小番茄，再放一把舒服的椅子';
    const r = C.recommend({ band: 'small', wish: wish });
    const mine = r.cards.find(p => p.custom);
    ok(mine, '有自定义卡');
    eq(mine.band, 'small', '档位');
    ok(mine.steps[0].indexOf(wish) !== -1, '步骤里有原话');
    ok(mine.title.indexOf('…') !== -1, '标题截断');
    ok(mine.output && mine.done && mine.steps.length >= 3, '四个字段');
  });

  test('做完的不再推；选的领域这一档都做完了 → 退回其他领域并标明', () => {
    const a = C.recommend({ band: 'medium', domains: ['life'], done: ['life-document'] });
    eq(a.cards.map(p => p.id).join(','), 'life-compare');
    const b = C.recommend({ band: 'large', domains: ['travel'], done: ['travel-trip'] });
    eq(b.fallback, true, '标明退回');
    ok(b.cards.length > 0 && b.cards.every(p => p.id !== 'travel-trip' && p.band === 'large'), '退回到其他领域的大档');
    const c = C.recommend({ band: 'small', wish: '整理衣柜', done: ['custom:整理衣柜'] });
    ok(!c.cards.some(p => p.custom), '做完的自定义卡也不再推');
  });

  test('自己写的领域：认得出同义词就按它推，认不出就列出全部并标明', () => {
    const a = C.recommend({ band: 'small', otherDomain: '旅游' });
    ok(a.cards.length && a.cards.every(p => p.domain === 'travel'), '旅游 → 旅行');
    const b = C.recommend({ band: 'small', otherDomain: '养宠物' });
    eq(b.fallback, true, '认不出');
    eq(b.cards.length, QP.PROJECTS.filter(p => p.band === 'small').length, '列出这一档全部');
  });

  test('自定义卡：结尾标点不会重复，本来就以「我想 / 想」开头的不再加「我想做」', () => {
    const a = C.customProject('我想去旅游。', 'small');
    ok(a.steps[0].indexOf('「我想去旅游。请先问我') !== -1, a.steps[0]);
    const b = C.customProject('想学游泳！！', 'medium');
    ok(b.steps[0].indexOf('「我想学游泳。请先问我') !== -1, b.steps[0]);
    const c = C.customProject('整理衣柜', 'large');
    ok(c.steps[0].indexOf('「我想做：整理衣柜。') !== -1, c.steps[0]);
    eq(c.id, 'custom:整理衣柜', 'id 用原话');
  });

  test('常见的「想做的事」→ 排第一的卡说得通（中档）', () => {
    const top = wish => C.recommend({ band: 'medium', wish: wish }).cards[0].id;
    eq(top('房东要涨租'), 'life-document', '房东要涨租');
    eq(top('想减肥'), 'health-eating', '想减肥');
    eq(top('想开个小红书账号'), 'create-posts', '小红书');
    eq(top('下周面试'), 'work-interview', '面试');
    eq(top('学做饭'), 'study-plan', '学做饭');
    eq(top('想学吉他'), 'study-plan', '学吉他');
    eq(top('想存钱买车'), 'life-compare', '买车');
    eq(top('给孩子讲睡前故事'), 'create-story', '睡前故事');
    eq(C.recommend({ band: 'large', wish: '想存钱买车' }).cards[0].id, 'life-budget', '大档：存钱');
  });

  window.addEventListener('load', () => runTests());
})();
