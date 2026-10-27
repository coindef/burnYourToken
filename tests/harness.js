/* 极简测试工具：test / eq / ok，结果写到页面和标题上，方便无头浏览器读取。 */
(function () {
  'use strict';
  const results = [];
  const queue = [];

  window.test = function (name, fn) { queue.push({ name: name, fn: fn }); };

  window.eq = function (actual, expected, what) {
    if (actual !== expected) {
      throw new Error((what ? what + '：' : '') + '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
    }
  };

  window.ok = function (cond, what) {
    if (!cond) throw new Error(what || '条件不成立');
  };

  window.runTests = async function () {
    for (const t of queue) {
      try {
        await t.fn();
        results.push({ name: t.name, pass: true });
      } catch (e) {
        results.push({ name: t.name, pass: false, err: e && e.message ? e.message : String(e) });
      }
    }
    const out = document.getElementById('out');
    results.forEach(r => {
      const li = document.createElement('li');
      li.className = r.pass ? 'pass' : 'fail';
      li.textContent = (r.pass ? '通过 ' : '失败 ') + r.name + (r.err ? ' —— ' + r.err : '');
      out.appendChild(li);
    });
    const failed = results.filter(r => !r.pass).length;
    const line = (failed ? 'FAIL' : 'PASS') + ' ' + (results.length - failed) + '/' + results.length;
    document.getElementById('summary').textContent = line;
    document.getElementById('summary').className = failed ? 'fail' : 'pass';
    document.title = line;
    window.TEST_RESULTS = results;
    return results;
  };

  window.addEventListener('error', e => {
    results.push({ name: '页面脚本报错', pass: false, err: e.message });
  });
})();
