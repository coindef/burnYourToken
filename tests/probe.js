/*
 * 不联网探针：在被测页面里故意用 5 种办法往外发东西，确认每一种都被页面自己的 Content-Security-Policy 拦下。
 * 每拦一次，浏览器都会在控制台打一条提示——这是预期的，所以这套单独跑，不和 e2e 的「控制台 0 报错」混在一起。
 * 目标地址只在本机：同一个测试服务器，或者 127.0.0.1:9（没有东西在听），万一没拦住也不会发到外面。
 */
(function () {
  'use strict';
  const frame = document.getElementById('app');
  let W = null;
  let D = null;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function loadApp() {
    return new Promise(resolve => {
      frame.onload = () => { W = frame.contentWindow; D = W.document; resolve(); };
      frame.src = '../index.html';
    });
  }

  // 做一件事，收集这段时间里页面报出的 CSP 拦截
  async function violations(action) {
    const seen = [];
    const on = e => seen.push(e.effectiveDirective || e.violatedDirective);
    D.addEventListener('securitypolicyviolation', on);
    try { await action(); } catch (e) { /* 被拦下时有的会抛错，下面看拦截记录 */ }
    await wait(300);
    D.removeEventListener('securitypolicyviolation', on);
    return seen;
  }

  test('被测页面正常加载（CSP 没把页面自己的 css/js 拦掉）', async () => {
    await loadApp();
    ok(W.QP && W.QP.app, 'app.js 跑完了');
    ok(W.getComputedStyle(D.body).backgroundColor !== 'rgba(0, 0, 0, 0)', 'css 生效了');
  });

  test('fetch 发请求 → 被拦下（connect-src）', async () => {
    let rejected = false;
    const seen = await violations(() => W.fetch('collect?q=1', { method: 'POST', body: 'x' }).catch(() => { rejected = true; }));
    ok(rejected, 'fetch 失败');
    ok(seen.indexOf('connect-src') !== -1, '拦截记录：' + seen.join());
  });

  test('XMLHttpRequest 发请求 → 被拦下（connect-src）', async () => {
    const seen = await violations(() => {
      const x = new W.XMLHttpRequest();
      x.open('POST', 'collect');
      x.send('x');
    });
    ok(seen.indexOf('connect-src') !== -1, '拦截记录：' + seen.join());
  });

  test('sendBeacon 偷偷上报 → 被拦下（connect-src）', async () => {
    const seen = await violations(() => W.navigator.sendBeacon('collect', 'x'));
    ok(seen.indexOf('connect-src') !== -1, '拦截记录：' + seen.join());
  });

  test('用图片地址往外带数据 → 被拦下（img-src）', async () => {
    const seen = await violations(() => { new W.Image().src = 'http://127.0.0.1:9/pixel.png?q=1'; });
    ok(seen.indexOf('img-src') !== -1, '拦截记录：' + seen.join());
  });

  test('把表单提交到别处 → 被拦下（form-action），页面没跳走', async () => {
    const seen = await violations(() => {
      const f = D.createElement('form');
      f.method = 'post';
      f.action = 'collect';
      D.body.appendChild(f);
      f.submit();
      f.remove();
    });
    ok(seen.indexOf('form-action') !== -1, '拦截记录：' + seen.join());
    ok(/\/index\.html$/.test(frame.contentWindow.location.pathname), '还在 index.html');
  });

  window.addEventListener('load', () => runTests());
})();
