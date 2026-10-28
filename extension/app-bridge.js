/*
 * burnYourToken tab. Listens for the Fill click and asks the extension to read Usage.
 * Does not read Claude by itself, and does not fill the form on load.
 */
(function () {
  'use strict';

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'byt-page' || data.type !== 'fill-request' || !data.id) return;
    const btn = document.getElementById('fill-usage-btn');
    if (!btn || btn.textContent.trim() !== 'Fill from Claude Usage') return;
    chrome.runtime.sendMessage({ type: 'BYT_FILL' }, response => {
      const failed = chrome.runtime.lastError;
      const payload = !failed && response ? response : { ok: false, error: 'parse' };
      window.postMessage({
        source: 'byt-extension',
        type: 'fill-result',
        id: data.id,
        ok: payload.ok === true,
        error: payload.ok === true ? '' : (payload.error || 'parse'),
        usage: payload.usage || null
      }, '*');
    });
  });
})();
