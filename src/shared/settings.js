/* Gemini Web Optimizer - settings (pure core + chrome.storage adapter). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeminiOptSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'goptSettings';
  const OPEN_PAST_CHATS_MIN = 0;
  const OPEN_PAST_CHATS_MAX = 999;
  const CONTENT_WIDTH_MIN = 60;
  const CONTENT_WIDTH_MAX = 100;
  const FONT_FAMILIES = Object.freeze(['default', 'sans', 'serif', 'mono']);
  const DEFAULT_TYPOGRAPHY_RESET = Object.freeze({
    fontFamily: 'default',
    fontSize: null,
    lineHeight: null,
    paragraphGap: null,
    letterSpacing: null
  });
  const DEFAULT_TEXT_OPT = Object.freeze(Object.assign({ fullWidth: true, contentWidth: 100 }, DEFAULT_TYPOGRAPHY_RESET));
  const DEFAULT_SETTINGS = Object.freeze({
    autoCollapse: true,
    openPastChats: 4,
    hideSources: true,
    showTokenUsage: true,
    textOpt: DEFAULT_TEXT_OPT
  });

  let warned = false;
  function warnOnce(err) {
    if (warned) return;
    warned = true;
    if (root.console && root.console.warn) root.console.warn('[gopt] storage unavailable:', err);
  }

  function bool(v, d) { return typeof v === 'boolean' ? v : d; }

  function numOrNull(v, min, max, decimals) {
    if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'object') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const clamped = Math.min(max, Math.max(min, n));
    const rounded = decimals ? Number(clamped.toFixed(decimals)) : Math.round(clamped);
    return rounded === 0 ? 0 : rounded;
  }

  function normalizeTextOpt(raw) {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const cw = numOrNull(r.contentWidth, CONTENT_WIDTH_MIN, CONTENT_WIDTH_MAX, 0);
    return {
      fullWidth: bool(r.fullWidth, DEFAULT_TEXT_OPT.fullWidth),
      contentWidth: cw !== null ? cw : DEFAULT_TEXT_OPT.contentWidth,
      fontFamily: FONT_FAMILIES.includes(r.fontFamily) ? r.fontFamily : DEFAULT_TEXT_OPT.fontFamily,
      fontSize: numOrNull(r.fontSize, 13, 22, 0),
      lineHeight: numOrNull(r.lineHeight, 1.2, 2.2, 2),
      paragraphGap: numOrNull(r.paragraphGap, 4, 28, 0),
      letterSpacing: numOrNull(r.letterSpacing, -0.03, 0.08, 2)
    };
  }

  function normalizeOpenPastChats(raw) {
    if (raw === null || raw === undefined || typeof raw === 'boolean' || typeof raw === 'object') {
      return DEFAULT_SETTINGS.openPastChats;
    }
    if (typeof raw === 'string' && raw.trim() === '') return DEFAULT_SETTINGS.openPastChats;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_SETTINGS.openPastChats;
    const clamped = Math.min(OPEN_PAST_CHATS_MAX, Math.max(OPEN_PAST_CHATS_MIN, Math.trunc(n)));
    return clamped === 0 ? 0 : clamped;
  }

  function normalizeSettings(raw) {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const d = DEFAULT_SETTINGS;
    // Migrate legacy openTurnLimit -> openPastChats transparently.
    const rawPast = r.openPastChats !== undefined ? r.openPastChats : r.openTurnLimit;
    return {
      autoCollapse: bool(r.autoCollapse, d.autoCollapse),
      openPastChats: normalizeOpenPastChats(rawPast),
      hideSources: bool(r.hideSources, d.hideSources),
      showTokenUsage: bool(r.showTokenUsage, d.showTokenUsage),
      textOpt: normalizeTextOpt(r.textOpt)
    };
  }

  function defaultArea() {
    return root.chrome && root.chrome.storage ? root.chrome.storage.local : undefined;
  }

  // Supports promise-style and callback-style get/set.
  function areaGet(area, key) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      const done = function (v) { if (!settled) { settled = true; resolve(v); } };
      try {
        const ret = area.get(key, function (res) {
          const le = root.chrome && root.chrome.runtime && root.chrome.runtime.lastError;
          if (le) { settled = true; reject(le); } else done(res);
        });
        if (ret && typeof ret.then === 'function') ret.then(done, function (e) { if (!settled) { settled = true; reject(e); } });
        else if (ret && typeof ret === 'object') done(ret);
      } catch (e) { reject(e); }
    });
  }

  function areaSet(area, obj) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      const ok = function () { if (!settled) { settled = true; resolve(); } };
      try {
        const ret = area.set(obj, function () {
          const le = root.chrome && root.chrome.runtime && root.chrome.runtime.lastError;
          if (le) { settled = true; reject(le); } else ok();
        });
        if (ret && typeof ret.then === 'function') ret.then(ok, function (e) { if (!settled) { settled = true; reject(e); } });
      } catch (e) { reject(e); }
    });
  }

  function loadSettings(storageArea) {
    const area = storageArea || defaultArea();
    if (!area) return Promise.resolve(normalizeSettings());
    return areaGet(area, STORAGE_KEY).then(
      function (res) { return normalizeSettings(res && res[STORAGE_KEY]); },
      function (err) { warnOnce(err); return normalizeSettings(); }
    );
  }

  // Per-area write serialization prevents concurrent read-modify-write races.
  const areaQueues = new WeakMap();
  let defaultQueue = Promise.resolve();

  function saveSettings(patch, storageArea) {
    const area = storageArea || defaultArea();
    const run = function () {
      return loadSettings(area).then(function (cur) {
        const merged = Object.assign({}, cur, patch || {});
        if (patch && patch.textOpt && typeof patch.textOpt === 'object' && !Array.isArray(patch.textOpt)) {
          merged.textOpt = Object.assign({}, cur.textOpt, patch.textOpt);
        }
        const next = normalizeSettings(merged);
        if (!area) return next;
        const obj = {}; obj[STORAGE_KEY] = next;
        return areaSet(area, obj).then(function () { return next; });
      });
    };
    const hasObjArea = !!(area && typeof area === 'object');
    const prev = hasObjArea ? (areaQueues.get(area) || Promise.resolve()) : defaultQueue;
    const p = prev.then(run, run);
    const tail = p.catch(function () {});
    if (hasObjArea) areaQueues.set(area, tail);
    else defaultQueue = tail;
    return p;
  }

  function onSettingsChanged(cb, storageApi) {
    const api = storageApi || (root.chrome && root.chrome.storage);
    if (!api || !api.onChanged || typeof api.onChanged.addListener !== 'function') return function () {};
    const listener = function (changes, areaName) {
      if (areaName !== 'local' || !changes || !(STORAGE_KEY in changes)) return;
      const c = changes[STORAGE_KEY];
      cb(normalizeSettings(c.newValue), normalizeSettings(c.oldValue));
    };
    api.onChanged.addListener(listener);
    return function () { api.onChanged.removeListener(listener); };
  }

  return Object.freeze({
    STORAGE_KEY, OPEN_PAST_CHATS_MIN, OPEN_PAST_CHATS_MAX,
    CONTENT_WIDTH_MIN, CONTENT_WIDTH_MAX, FONT_FAMILIES,
    DEFAULT_TYPOGRAPHY_RESET, DEFAULT_TEXT_OPT, DEFAULT_SETTINGS,
    normalizeTextOpt, normalizeSettings, loadSettings, saveSettings, onSettingsChanged
  });
});
