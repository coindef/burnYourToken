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
  const $ = id => D.getElementById(id);
  const text = node => (node ? node.textContent : '');

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
  const resultOf = p => D.querySelector('#calc-results .result[data-service="' + p + '"]');
  const cards = () => Array.from(D.querySelectorAll('#recs-list .card'));
  const smallerCards = () => Array.from(D.querySelectorAll('#smaller-list .card'));
  const othersCards = () => Array.from(D.querySelectorAll('#others-list .card'));
  const bandCount = band => W.QP.PROJECTS.filter(p => p.band === band).length;
  const statusText = () => text($('recs-status'));

  async function fresh() {
    W.QP.app.clearAll();
    $('clear-msg').hidden = true;
    await wait(0);
  }

  // ---------------- 测试 ----------------

  test('页面正常加载：两张服务卡、7 个领域选项、还没算时提示先算', async () => {
    await loadApp(true);
    ok(W.QP && W.QP.app, 'app.js 跑完了');
    ok($('svc-claude') && $('svc-chatgpt'), '两张服务卡');
    eq(D.querySelectorAll('input[name="q-domain"]').length, 7, '领域选项');
    ok(statusText().indexOf('先在第 1 步') !== -1, '提示先算');
    eq(D.getElementById('clear-btn').textContent.trim(), '清除我的回答', '清除按钮');
  });

  test('页面上写清楚：窗口不是 token 数、用量页给的是百分比和重置时间、档位是经验规则、API 不适用', () => {
    const t = text(D.querySelector('.honest'));
    ok(/窗口/.test(t) && /token/.test(t), '窗口 / token');
    ok(/百分之几/.test(t) && /什么时候重置/.test(t), '百分比和重置时间');
    ok(/经验规则/.test(t) && /不是厂商给的数字/.test(t), '经验规则');
    ok(/API/.test(t) && /不适用/.test(t), 'API 不适用');
  });

  test('计算器：5 小时已用 85%、周已用 30% → 小档（有一个不到 20%），卡在 5 小时额度；推荐全是小档', async () => {
    await fresh();
    fill('claude', { s: 85, w: 30 });
    calc();
    const r = resultOf('claude');
    eq(r && r.dataset.band, 'small', '档位');
    ok(text(r).indexOf('卡在 5 小时额度') !== -1, '写明瓶颈');
    ok(text(r).indexOf('有效剩余 15%') !== -1, '有效剩余 15%');
    ok(text(r).indexOf('有一个剩不到 20%') !== -1, '写明是哪条规则');
    ok(cards().length > 0, '有推荐');
    cards().forEach(c => eq(c.dataset.band, 'small', '卡片档位'));
    eq(smallerCards().length, 0, '小档下面没有更小的');
    ok($('recs-smaller').hidden, '「小一点的」不显示');
  });

  test('计算器：5 小时已用 80%（剩 20%）→ 中档（20% 算中），推荐全是中档', async () => {
    await fresh();
    fill('claude', { s: 80, w: 30 });
    calc();
    const r = resultOf('claude');
    eq(r.dataset.band, 'medium', '档位');
    ok(text(r).indexOf('有效剩余 20%') !== -1, '有效剩余 20%');
    ok(text(r).indexOf('有一个只剩 20%–50%') !== -1, '写明是哪条规则');
    ok(cards().length > 0 && cards().every(c => c.dataset.band === 'medium'), '主推荐全是中档');
    ok(smallerCards().every(c => c.dataset.band === 'small'), '折叠里只有小档');
  });

  test('计算器：两个窗口都剩一半以上、离每周重置超过 1 天 → 大档；推荐是大档，更小的放在折叠里', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    eq(resultOf('claude').dataset.band, 'large', '档位');
    ok(text(resultOf('claude')).indexOf('离每周额度重置也还有 1 天以上') !== -1, '写明是哪条规则');
    ok(cards().length > 0 && cards().every(c => c.dataset.band === 'large'), '主推荐全是大档');
    ok(!$('recs-smaller').hidden, '有「小一点的」');
    ok(smallerCards().every(c => c.dataset.band === 'small' || c.dataset.band === 'medium'), '折叠里只有更小的');
  });

  test('计算器：离每周额度重置只剩 20 分钟 → 只能小档，并写明是时间不够', async () => {
    await fresh();
    fill('claude', { s: 10, w: 10, day: 1, wclock: '10:20' });
    calc();
    const r = resultOf('claude');
    eq(r.dataset.band, 'small', '档位');
    ok(text(r).indexOf('只剩几小时（不到 5 小时）') !== -1, '写明原因');
    cards().forEach(c => eq(c.dataset.band, 'small', '卡片档位'));
  });

  test('计算器：两个都剩 90%、离每周重置不到 1 天（22 小时）→ 中档，并写明原因', async () => {
    await fresh();
    fill('claude', { s: 10, w: 10, day: 2, wclock: '08:00' });
    calc();
    const r = resultOf('claude');
    eq(r.dataset.band, 'medium', '档位');
    ok(text(r).indexOf('离每周额度重置不到 1 天') !== -1, '写明原因');
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
    ok(text(r).indexOf('可能就是大档') !== -1, '有提醒');
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
    ok(statusText().indexOf('领域：健康') !== -1, '状态里写了按什么挑的');
  });

  test('问卷：大档 + 生活和创作 → 推荐跟着领域走，且不会出现超过档位的', async () => {
    await fresh();
    fill('claude', { s: 0, w: 0 });
    calc();
    pick('input[name="q-domain"][value="life"]');
    pick('input[name="q-domain"][value="create"]');
    const ids = cards().map(c => c.dataset.id).sort().join(',');
    eq(ids, 'create-memory-book,life-budget', '大档的生活 + 创作');
    smallerCards().forEach(c => ok(c.dataset.band !== 'large', '折叠里没有大档'));
  });

  test('问题 2 写想做的事 → 多一张按这件事做的卡；原话照原样显示，不会被当成网页代码执行', async () => {
    await fresh();
    fill('claude', { s: 60, w: 20 });
    calc();
    const wish = '<img src=x onerror="window.__xss=1">给妈妈过生日';
    setVal('q-wish', wish);
    await wait(50);
    const mine = cards().find(c => c.dataset.id.indexOf('custom:') === 0);
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
    const first = cards()[0];
    eq(first.dataset.id, 'travel-trip', '第一张');
    eq(first.dataset.top, '1', '标着最贴合');
    ok(text(first).indexOf('最贴合你') !== -1, '看得见「最贴合你」');
    eq(D.querySelectorAll('#recs-list [data-top]').length, 1, '只有一张最贴合');
    const why = Array.from(first.querySelectorAll('.why-pref li')).map(text);
    eq(why.length, 3, '对上 3 点：' + why.join(' / '));
    ok(/旅行/.test(why[0]) && /一份计划或方案/.test(why[1]) && /给家人、朋友或孩子/.test(why[2]), why.join(' / '));
    ok(text(first.querySelector('.why-band')).indexOf('你现在剩的是大档') !== -1, '档位理由');
    cards().forEach(c => {
      eq(c.dataset.band, 'large', c.dataset.id + ' 主推荐档位');
      ok(c.querySelectorAll('.why-pref li').length > 0, c.dataset.id + ' 写着对上了什么');
    });
    ok(!$('recs-others').hidden, '有「同一档的其他项目」');
    othersCards().forEach(c => {
      eq(c.dataset.band, 'large', c.dataset.id + ' 其他也是同档');
      ok(text(c.querySelector('.why-pref')).indexOf('没对上') !== -1, c.dataset.id + ' 写着没对上');
    });
    eq(cards().length + othersCards().length, bandCount('large'), '同一档一个不少');
    smallerCards().forEach(c => ok(c.dataset.band !== 'large', c.dataset.id + ' 折叠里没有大档'));
    ok(statusText().indexOf('想要的成果：一份计划或方案') !== -1 && statusText().indexOf('给谁：给家人、朋友或孩子') !== -1, '状态里写了按什么排的');
  });

  test('偏好 × 中档：只选「一张表或清单」→ 对上的排前面；换成「弄懂或练熟一件事」→ 排序跟着变；都不超档', async () => {
    await fresh();
    fill('claude', { s: 60, w: 20 }); // 有效剩余 40% → 中档
    calc();
    pick('input[name="q-output"][value="list"]');
    const listIds = cards().map(c => c.dataset.id);
    eq(listIds[0], 'work-checklist', '表 / 清单：第一张');
    ok(listIds.every(id => W.QP.PROJECTS.find(p => p.id === id).outputs.indexOf('list') !== -1), '主推荐都是表或清单：' + listIds.join());
    unpick('input[name="q-output"][value="list"]');
    pick('input[name="q-output"][value="learn"]');
    const learnIds = cards().map(c => c.dataset.id);
    eq(learnIds[0], 'work-interview', '弄懂 / 练熟：第一张');
    ok(listIds.join() !== learnIds.join(), '排序跟着变了');
    cards().concat(othersCards()).forEach(c => eq(c.dataset.band, 'medium', c.dataset.id + ' 档位'));
    smallerCards().forEach(c => eq(c.dataset.band, 'small', c.dataset.id + ' 折叠里只有小档'));
  });

  test('偏好 × 小档：选「工作上要用」→ 第一张是写工作消息，标「最贴合你」；其余小档在折叠里', async () => {
    await fresh();
    fill('claude', { s: 85, w: 30 });
    calc();
    pick('input[name="q-audience"][value="work"]');
    eq(cards()[0].dataset.id, 'work-message', '第一张');
    eq(cards()[0].dataset.top, '1', '最贴合');
    ok(text(cards()[0].querySelector('.why-pref')).indexOf('工作上要用') !== -1, '写着对上了「工作上要用」');
    cards().concat(othersCards()).forEach(c => eq(c.dataset.band, 'small', c.dataset.id + ' 档位'));
    eq(cards().length + othersCards().length, bandCount('small'), '同一档一个不少');
    eq(smallerCards().length, 0, '小档下面没有更小的');
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
      eq(cards().length, bandCount(c[1]), c[1] + '：这一档全列出来');
      cards().forEach(n => {
        eq(n.dataset.band, c[1], n.dataset.id + ' 档位');
        ok(text(n.querySelector('.why-pref')).indexOf('只按档位') !== -1, n.dataset.id + ' 写着按档位挑');
        ok(text(n.querySelector('.why-band')).indexOf('不会超出你的剩余') !== -1, n.dataset.id + ' 写着不超档');
      });
      eq(D.querySelectorAll('#recs-list [data-top]').length, 0, '没填偏好就不标「最贴合」');
      ok($('recs-others').hidden, '没有「同一档的其他」');
      ok(statusText().indexOf('跳过了') !== -1, '状态里说了是跳过的');
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
        ok(statusText().indexOf('用完了') !== -1 && statusText().indexOf('5 小时额度') !== -1, '告诉你等哪个重置');
        break;
      }
      ok(D.querySelector('input[name="q-output"][value="plan"]').checked, band + '：偏好还在');
      cards().forEach(c => {
        eq(c.dataset.band, band, c.dataset.id + ' 档位');
        ok(done.indexOf(c.dataset.id) === -1, c.dataset.id + ' 做完的不再推');
      });
      if (done.length) ok(statusText().indexOf('已经做完 ' + done.length + ' 个') !== -1, '记着做完了几个');
      const c = cards()[0];
      done.push(c.dataset.id);
      c.querySelector('.done-btn').click();
      ok(!$('done-banner').hidden, '出现「做完了」');
      ok(text($('done-round')).indexOf('每周额度离重置还有 2 天 22 小时') !== -1, '写着离每周重置还有多久：' + text($('done-round')));
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
      eq(cards().length + othersCards().length, total - i, '第 ' + (i + 1) + ' 轮还剩几张（主推荐 + 同一档的其他）');
      if (i === 0) eq(cards().length, 1, '一开始只有「工作上要用」对上的那张在主推荐');
      if (i === 1) {
        ok(statusText().indexOf('暂时没有对得上') !== -1, '对上的做完了 → 说明是退回列出这一档的');
        eq(cards().length, total - 1, '其余的都列进主推荐');
      }
      cards()[0].querySelector('.done-btn').click();
      calc();
    }
    eq(cards().length, 0, '全做完了');
    ok(statusText().indexOf('这一档现成的项目你都做完了') !== -1, '告诉你都做完了');
    ok(statusText().indexOf('暂时没有对得上') === -1, '不再说「先列出来」');
    setVal('q-wish', '整理衣柜');
    eq(cards().length, 1, '写了想做的事 → 只剩那张现做的');
    ok(cards()[0].dataset.id === 'custom:整理衣柜', '是现做的那张');
    ok(statusText().indexOf('可以做下面这张按你写的事现做的') !== -1 && statusText().indexOf('暂时没有对得上') === -1, statusText());
  });

  test('做完一个 → 提示回去重新算 → 重新算后推下一个，做完的不再出现', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 }); // 大档
    calc();
    const first = cards()[0];
    const doneId = first.dataset.id;
    first.querySelector('.done-btn').click();
    ok(!$('done-banner').hidden, '出现「做完了」提示');
    ok(text($('done-banner')).indexOf('重新抄一遍') !== -1, '提示重新抄数字');
    eq(cards().length, 0, '重新算之前不推下一个');
    ok(text($('calc-results')).indexOf('已经过时') !== -1, '计算结果标为过时');
    $('recalc-btn').click();
    eq(D.activeElement && D.activeElement.id, 'claude-s-pct', '光标回到第 1 步的百分比');
    setVal('claude-s-pct', '60'); // 做完项目用掉了一些：剩 40% → 中档
    calc();
    ok($('done-banner').hidden, '提示消失');
    eq(resultOf('claude').dataset.band, 'medium', '新档位');
    ok(cards().length > 0, '推了下一批');
    ok(cards().every(c => c.dataset.id !== doneId && c.dataset.band === 'medium'), '没有做完的，档位跟着新剩余');
    ok(statusText().indexOf('已经做完 1 个') !== -1, '记着做完了几个');
  });

  test('两个服务分开算：结果分开显示、不相加；问题 5 选哪个就按哪个推', async () => {
    await fresh();
    fill('claude', { s: 85, w: 30 }); // 小档
    fill('chatgpt', { plan: 'plus', s: 10, w: 20 }); // 大档
    calc();
    eq(resultOf('claude').dataset.band, 'small', 'Claude');
    eq(resultOf('chatgpt').dataset.band, 'large', 'ChatGPT');
    const all = text($('calc-results'));
    ok(all.indexOf('不相加') !== -1, '写明不相加');
    ok(!/合计|加起来一共|总共剩/.test(all), '没有相加的数字');
    // 问题 5 没选：按剩得多的那个推，并说明
    ok(statusText().indexOf('ChatGPT') !== -1 && statusText().indexOf('剩得多') !== -1, '默认按剩得多的推');
    cards().forEach(c => eq(c.dataset.band, 'large', '默认大档'));
    pick('input[name="q-service"][value="claude"]');
    ok(cards().length && cards().every(c => c.dataset.band === 'small'), '选 Claude → 小档');
    pick('input[name="q-service"][value="chatgpt"]');
    ok(cards().length && cards().every(c => c.dataset.band === 'large'), '选 ChatGPT → 大档');
  });

  test('问题 5 选了没算过的服务 → 提示先去算', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    pick('input[name="q-service"][value="chatgpt"]');
    eq(cards().length, 0, '不推');
    ok(statusText().indexOf('还没算它的剩余') !== -1, '提示');
  });

  test('按 API 用量付钱 → 写明不适用，不出档位', async () => {
    await fresh();
    setVal('claude-plan', 'api');
    ok(!$('claude-api').hidden && $('claude-body').hidden, '显示不适用，隐藏输入');
    calc();
    ok(text(resultOf('claude')).indexOf('不适用') !== -1, '结果写不适用');
    eq(cards().length, 0, '不推项目');
  });

  test('填错了 → 指出是哪一格', async () => {
    await fresh();
    fill('claude', { s: 150, w: 30 });
    setVal('claude-w-day', '');
    calc();
    eq($('claude-s-pct').getAttribute('aria-invalid'), 'true', '百分比标红');
    eq($('claude-w-day').getAttribute('aria-invalid'), 'true', '周几标红');
    ok(resultOf('claude').classList.contains('result-error'), '显示错误');
    eq(cards().length, 0, '不推');
  });

  test('额度用完 → 不推项目，告诉你等多久', async () => {
    await fresh();
    fill('claude', { s: 20, w: 100 });
    calc();
    eq(resultOf('claude').dataset.band, 'none', '档位');
    eq(cards().length, 0, '不推');
    ok(statusText().indexOf('用完了') !== -1 && statusText().indexOf('每周额度') !== -1, '告诉你等哪个');
  });

  test('改了数字没重新算 → 第 1 步和第 3 步都提示点「算一下」', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    calc();
    setVal('claude-s-pct', '90');
    ok(text($('calc-results')).indexOf('还没重新算') !== -1, '第 1 步提示');
    ok(statusText().indexOf('还没点「算一下」') !== -1, '第 3 步提示');
    calc();
    ok(statusText().indexOf('还没点「算一下」') === -1, '算完提示消失');
  });

  test('两个服务算出来一样大、问题 5 没选 → 不说「剩得多」，说「一样大」', async () => {
    await fresh();
    fill('claude', { s: 30, w: 40 });
    fill('chatgpt', { plan: 'plus', s: 20, w: 10 });
    calc();
    ok(statusText().indexOf('一样大') !== -1 && statusText().indexOf('剩得多') === -1, statusText());
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
    const all = cards().concat(smallerCards());
    eq(new Set(all.map(c => c.dataset.id)).size, W.QP.PROJECTS.length, '项目数');
    all.forEach(c => {
      const dts = Array.from(c.querySelectorAll('dt')).map(n => n.textContent);
      eq(dts.join('|'), '档位|为什么推给你|目标产出|大概步骤|验收标准（做完手里有什么）', c.dataset.id + ' 五个字段');
      ok(text(c.querySelector('.why-band')).length > 0, c.dataset.id + ' 档位理由');
      ok(text(c.querySelector('.why-pref')).length > 0, c.dataset.id + ' 偏好理由');
      ok(c.querySelectorAll('dd ol li').length >= 3, c.dataset.id + ' 步骤');
      ok(c.querySelector('h3').textContent.length > 0, c.dataset.id + ' 标题');
      ok(c.querySelector('.done-btn'), c.dataset.id + ' 做完按钮');
    });
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
    pick('input[name="q-service"][value="claude"]');
    cards()[0].querySelector('.done-btn').click();
    ok(W.sessionStorage.getItem('qp-v0'), '清除前有存');
    $('clear-btn').click();
    eq($('claude-plan').value, '', '服务档位');
    eq($('claude-s-pct').value, '', '百分比');
    eq(D.querySelectorAll('input[name="q-domain"]:checked').length, 0, '领域');
    eq(D.querySelectorAll('input[name="q-output"]:checked, input[name="q-audience"]:checked').length, 0, '成果、给谁');
    eq($('q-other').value + $('q-wish').value, '', '自己写的');
    eq(D.querySelectorAll('input[name="q-service"]:checked').length, 0, '问题 5');
    eq(text($('calc-results')), '', '计算结果');
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
    fill('chatgpt', { plan: 'plus', s: 80, w: 30 });
    calc();
    pick('input[name="q-domain"][value="life"]');
    pick('input[name="q-domain"][value="travel"]');
    pick('input[name="q-output"][value="text"]');
    pick('input[name="q-audience"][value="family"]');
    setVal('q-wish', '给妈妈过 60 岁生日，想做一本相册');
    $('recs-others').open = true;
    $('recs-smaller').open = true;
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
