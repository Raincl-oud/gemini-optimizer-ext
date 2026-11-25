/* Gemini Web Optimizer - MV3 background service worker for silent official /usage sync.
 * UMD exports GeminiOptUsageSync for Node unit testing; auto-wires Chrome listeners only in SW runtime. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeminiOptUsageSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'goptTokenUsage';
  const USAGE_SYNC_URL = 'https://gemini.google.com/usage#gopt-sync';
  const SYNC_TIMEOUT_MS = 16000;
  const MIN_SYNC_INTERVAL_MS = 4000;
  const SESSION_TAB_KEY = 'goptSyncTabId';

  function callStorageGet(area, key, runtimeErrorFn) {
    return new Promise(function (resolve) {
      if (!area || typeof area.get !== 'function') return resolve({});
      try {
        let settled = false;
        const done = function (res) {
          if (!settled) { settled = true; resolve(res || {}); }
        };
        const ret = area.get(key, function (res) {
          if (runtimeErrorFn && runtimeErrorFn()) {
            done({});
          } else {
            done(res);
          }
        });
        if (ret && typeof ret.then === 'function') {
          ret.then(done, function () { done({}); });
        }
      } catch (_) { resolve({}); }
    });
  }

  function callStorageSet(area, obj) {
    return new Promise(function (resolve) {
      if (!area || typeof area.set !== 'function') return resolve();
      try {
        let settled = false;
        const done = function () { if (!settled) { settled = true; resolve(); } };
        const ret = area.set(obj, done);
        if (ret && typeof ret.then === 'function') ret.then(done, done);
      } catch (_) { resolve(); }
    });
  }

  function callStorageRemove(area, key) {
    return new Promise(function (resolve) {
      if (!area || typeof area.remove !== 'function') return resolve();
      try {
        let settled = false;
        const done = function () { if (!settled) { settled = true; resolve(); } };
        const ret = area.remove(key, done);
        if (ret && typeof ret.then === 'function') ret.then(done, done);
      } catch (_) { resolve(); }
    });
  }

  function createSyncController(deps) {
    const d = deps || {};
    const tabs = d.tabs;
    const storage = d.storage || {};
    const localArea = storage.local || null;
    const sessionArea = storage.session || null;
    const setTimeoutFn = d.setTimeout || root.setTimeout.bind(root);
    const clearTimeoutFn = d.clearTimeout || root.clearTimeout.bind(root);
    const nowFn = d.now || function () { return Date.now(); };
    const runtimeErrorFn = d.runtimeLastError || function () {
      return root.chrome && root.chrome.runtime ? root.chrome.runtime.lastError : null;
    };

    let inFlightTabId = null;
    let pendingCreate = false;
    let timeoutId = 0;
    let lastSyncStartedAt = 0;

    function clearSafetyTimer() {
      if (timeoutId) {
        clearTimeoutFn(timeoutId);
        timeoutId = 0;
      }
    }

    function mirrorSessionTab(tabId) {
      if (!sessionArea) return;
      if (tabId === null || tabId === undefined) {
        callStorageRemove(sessionArea, SESSION_TAB_KEY);
      } else {
        const obj = {};
        obj[SESSION_TAB_KEY] = tabId;
        callStorageSet(sessionArea, obj);
      }
    }

    function removeTab(tabId) {
      if (!tabs || typeof tabs.remove !== 'function' || tabId === null || tabId === undefined) {
        return Promise.resolve();
      }
      return new Promise(function (resolve) {
        try {
          let settled = false;
          const done = function () { if (!settled) { settled = true; resolve(); } };
          const ret = tabs.remove(tabId, function () {
            void (runtimeErrorFn && runtimeErrorFn());
            done();
          });
          if (ret && typeof ret.then === 'function') ret.then(done, done);
        } catch (_) { resolve(); }
      });
    }

    function createTab(opts) {
      if (!tabs || typeof tabs.create !== 'function') return Promise.resolve(null);
      return new Promise(function (resolve) {
        try {
          let settled = false;
          const done = function (tab) { if (!settled) { settled = true; resolve(tab || null); } };
          const ret = tabs.create(opts, function (tab) {
            if (runtimeErrorFn && runtimeErrorFn()) done(null);
            else done(tab);
          });
          if (ret && typeof ret.then === 'function') ret.then(done, function () { done(null); });
        } catch (_) { resolve(null); }
      });
    }

    function closeSyncTab(tabId) {
      if (tabId === null || tabId === undefined) return Promise.resolve();
      if (tabId === inFlightTabId) {
        clearSafetyTimer();
        inFlightTabId = null;
        mirrorSessionTab(null);
      }
      return removeTab(tabId);
    }

    async function saveSyncedUsage(data) {
      if (!localArea || !data || typeof data !== 'object') return null;
      const res = await callStorageGet(localArea, STORAGE_KEY, runtimeErrorFn);
      const existing = res && res[STORAGE_KEY] && typeof res[STORAGE_KEY] === 'object' ? res[STORAGE_KEY] : {};
      const nextPlan = data.detectedPlan || existing.detectedPlan || null;
      const nextConf = data.detectedPlan ? 'high' : (existing.planConfidence || 'default');
      const tNow = nowFn();
      const scraped5hReset = Number(data.window5hResetAt) || 0;
      const prev5hReset = Number(existing.window5hResetAt) || 0;
      let window5hResetAt = 0;
      let window5hResetProvisional = false;
      if (scraped5hReset > 0) {
        window5hResetAt = scraped5hReset;
        window5hResetProvisional = false;
      } else if (Number(data.window5hPct) > 0 && prev5hReset > tNow) {
        window5hResetAt = prev5hReset;
        window5hResetProvisional = !!existing.window5hResetProvisional;
      } else if (existing.window5hResetProvisional && prev5hReset > tNow) {
        window5hResetAt = prev5hReset;
        window5hResetProvisional = true;
      }
      const scrapedWeekReset = Number(data.weeklyResetAt) || 0;
      const prevWeekReset = Number(existing.weeklyResetAt) || 0;
      let weeklyResetAt = 0;
      let weeklyResetProvisional = false;
      if (scrapedWeekReset > 0) {
        weeklyResetAt = scrapedWeekReset;
        weeklyResetProvisional = false;
      } else if (Number(data.weeklyPct) > 0 && prevWeekReset > tNow) {
        weeklyResetAt = prevWeekReset;
        weeklyResetProvisional = !!existing.weeklyResetProvisional;
      } else if (existing.weeklyResetProvisional && prevWeekReset > tNow) {
        weeklyResetAt = prevWeekReset;
        weeklyResetProvisional = true;
      }
      const merged = {
        detectedPlan: nextPlan,
        planConfidence: nextPlan ? nextConf : 'default',
        syncedAt: Number(data.syncedAt) || tNow,
        window5hPct: data.window5hPct !== undefined && data.window5hPct !== null ? Number(data.window5hPct) : null,
        window5hResetAt: window5hResetAt,
        window5hResetProvisional: window5hResetProvisional,
        weeklyPct: data.weeklyPct !== undefined && data.weeklyPct !== null ? Number(data.weeklyPct) : null,
        weeklyResetAt: weeklyResetAt,
        weeklyResetProvisional: weeklyResetProvisional
      };
      const payload = {};
      payload[STORAGE_KEY] = merged;
      await callStorageSet(localArea, payload);
      return merged;
    }

    async function triggerUsageSync(reason) {
      const tNow = nowFn();
      if (pendingCreate || inFlightTabId !== null) {
        return { started: false, reason: 'IN_FLIGHT' };
      }
      if (reason !== 'install' && reason !== 'manual' && lastSyncStartedAt > 0 && (tNow - lastSyncStartedAt) < MIN_SYNC_INTERVAL_MS) {
        return { started: false, reason: 'THROTTLED' };
      }
      pendingCreate = true;
      lastSyncStartedAt = tNow;
      const tab = await createTab({ url: USAGE_SYNC_URL, active: false });
      pendingCreate = false;
      if (!tab || tab.id === undefined || tab.id === null) {
        return { started: false, reason: 'CREATE_FAILED' };
      }
      inFlightTabId = tab.id;
      mirrorSessionTab(tab.id);
      clearSafetyTimer();
      timeoutId = setTimeoutFn(function () {
        timeoutId = 0;
        closeSyncTab(tab.id);
      }, SYNC_TIMEOUT_MS);
      return { started: true, tabId: tab.id };
    }

    function onTabRemoved(tabId) {
      if (tabId !== null && tabId !== undefined && tabId === inFlightTabId) {
        clearSafetyTimer();
        inFlightTabId = null;
        mirrorSessionTab(null);
      }
    }

    async function isKnownSyncTab(msg, sender) {
      if (!sender || !sender.tab || sender.tab.id === undefined || sender.tab.id === null) return false;
      if (sender.tab.id === inFlightTabId) return true;
      if (msg && msg.isAutoSync === true) return true;
      if (sessionArea) {
        const res = await callStorageGet(sessionArea, SESSION_TAB_KEY, runtimeErrorFn);
        if (res && res[SESSION_TAB_KEY] === sender.tab.id) return true;
      }
      return false;
    }

    function handleMessage(msg, sender, sendResponse) {
      const reply = typeof sendResponse === 'function' ? sendResponse : function () {};
      if (!msg || typeof msg !== 'object') return false;

      if (msg.type === 'TRIGGER_USAGE_SYNC') {
        if (sender && sender.tab && sender.tab.url && /\/usage\b/i.test(sender.tab.url)) {
          reply({ ok: false, ignored: true });
          return false;
        }
        triggerUsageSync(msg.reason || 'chat').then(
          function (res) { reply(Object.assign({ ok: true }, res)); },
          function () { reply({ ok: false }); }
        );
        return true;
      }

      if (msg.type === 'USAGE_SYNC_RESULT') {
        const tabId = sender && sender.tab && sender.tab.id !== undefined ? sender.tab.id : null;
        Promise.resolve(isKnownSyncTab(msg, sender)).then(async function (shouldClose) {
          try {
            await saveSyncedUsage(msg.data);
          } finally {
            if (shouldClose && tabId !== null) await closeSyncTab(tabId);
            else if (tabId !== null && tabId === inFlightTabId) {
              clearSafetyTimer();
              inFlightTabId = null;
              mirrorSessionTab(null);
            }
          }
          reply({ ok: true, closed: shouldClose });
        });
        return true;
      }

      if (msg.type === 'USAGE_SYNC_ABORT') {
        const tabId = sender && sender.tab && sender.tab.id !== undefined ? sender.tab.id : null;
        Promise.resolve(isKnownSyncTab(msg, sender)).then(async function (shouldClose) {
          if (shouldClose && tabId !== null) await closeSyncTab(tabId);
          reply({ ok: true, closed: shouldClose });
        });
        return true;
      }

      return false;
    }

    async function handleInstalled(details) {
      if (!details || details.reason === 'install') {
        return triggerUsageSync('install');
      }
      if (details.reason === 'update') {
        const res = await callStorageGet(localArea, STORAGE_KEY, runtimeErrorFn);
        const cur = res && res[STORAGE_KEY];
        if (!cur || !cur.syncedAt) return triggerUsageSync('install');
      }
      return { started: false, reason: 'ALREADY_SYNCED' };
    }

    function getState() {
      return { inFlightTabId: inFlightTabId, pendingCreate: pendingCreate, lastSyncStartedAt: lastSyncStartedAt, hasTimeout: timeoutId !== 0 };
    }

    return Object.freeze({
      triggerUsageSync, closeSyncTab, saveSyncedUsage, onTabRemoved, handleMessage, handleInstalled, getState
    });
  }

  const isNodeEnv = (typeof module === 'object' && !!module.exports) ||
    (typeof process === 'object' && !!(process.versions && process.versions.node));
  if (!isNodeEnv && root.chrome && root.chrome.runtime) {
    const ctrl = createSyncController({
      tabs: root.chrome.tabs,
      storage: root.chrome.storage,
      setTimeout: root.setTimeout.bind(root),
      clearTimeout: root.clearTimeout.bind(root),
      now: function () { return Date.now(); },
      runtimeLastError: function () { return root.chrome && root.chrome.runtime ? root.chrome.runtime.lastError : null; }
    });
    if (root.chrome.runtime.onMessage) root.chrome.runtime.onMessage.addListener(ctrl.handleMessage);
    if (root.chrome.tabs && root.chrome.tabs.onRemoved) root.chrome.tabs.onRemoved.addListener(ctrl.onTabRemoved);
    if (root.chrome.runtime.onInstalled) root.chrome.runtime.onInstalled.addListener(ctrl.handleInstalled);
  }

  return Object.freeze({
    STORAGE_KEY, USAGE_SYNC_URL, SYNC_TIMEOUT_MS, MIN_SYNC_INTERVAL_MS, SESSION_TAB_KEY,
    createSyncController
  });
});
