/*
 * Claude tab. Does nothing until the extension asks, which happens only
 * after Fill from Claude Usage is clicked. Does not fetch, calculate, or mark done.
 */
(function () {
  'use strict';
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'BYT_EXTRACT') return;
    if (sender.id && sender.id !== chrome.runtime.id) return;
    try {
      sendResponse(parseUsageRoot(document));
    } catch (e) {
      sendResponse({ ok: false });
    }
  });
})();
