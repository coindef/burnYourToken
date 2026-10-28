/*
 * Relays one Fill click to an open Claude tab and returns the three numbers.
 * No alarms, no fetch, no Claude API. Nothing is read until a fill message arrives.
 */
(function () {
  'use strict';

  function rank(tab) {
    const url = tab.url || '';
    let score = 0;
    if (/settings\/usage/i.test(url)) score += 4;
    if (tab.active) score += 1;
    return score;
  }

  function ask(tabId) {
    return new Promise(resolve => {
      try {
        chrome.tabs.sendMessage(tabId, { type: 'BYT_EXTRACT' }, res => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function extractFromTab(tabId) {
    const first = await ask(tabId);
    if (first) return first;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['usage-parse.js', 'claude-content.js']
      });
    } catch (e) {
      return null;
    }
    return ask(tabId);
  }

  async function fillFromUsage() {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({ url: ['https://claude.ai/*'] });
    } catch (e) {
      return { ok: false, error: 'parse' };
    }
    tabs.sort((a, b) => rank(b) - rank(a));
    for (let i = 0; i < tabs.length; i++) {
      const usage = await extractFromTab(tabs[i].id);
      if (usage && usage.ok) return { ok: true, usage: usage };
    }
    return { ok: false, error: 'parse' };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'BYT_FILL') return;
    if (sender.id && sender.id !== chrome.runtime.id) return;
    fillFromUsage().then(sendResponse, () => sendResponse({ ok: false, error: 'parse' }));
    return true;
  });
})();
