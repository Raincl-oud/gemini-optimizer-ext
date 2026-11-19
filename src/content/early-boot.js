/* Gemini Web Optimizer - document_start synchronous pre-wrap & cold-load guard.
 * Zero-dependency UMD (side-effect-free on Node require). Never sets gopt-text-fullwidth on Home screen. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeminiOptEarly = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const EARLY_STORAGE_KEY = 'goptEarly';
  const PREWRAP_STYLE_ID = 'gopt-prewrap-style';
  const COLD_LOAD_CAP_MS = 500;
  const OPEN_PAST_MIN = 0;
  const OPEN_PAST_MAX = 999;
  const DEFAULT_EARLY = Object.freeze({
    autoCollapse: true,
    openPastChats: 4,
    hideSources: true
  });

  let coldTimer = 0;
  let coldWin = null;

  function normalizeOpenPast(raw) {
    if (raw === null || raw === undefined || typeof raw === 'boolean' || typeof raw === 'object') {
      return DEFAULT_EARLY.openPastChats;
    }
    if (typeof raw === 'string' && raw.trim() === '') return DEFAULT_EARLY.openPastChats;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_EARLY.openPastChats;
    const clamped = Math.min(OPEN_PAST_MAX, Math.max(OPEN_PAST_MIN, Math.trunc(n)));
    return clamped === 0 ? 0 : clamped;
  }

  function parseEarlyMirror(raw) {
    let r = raw;
    if (typeof raw === 'string') {
      try { r = JSON.parse(raw); } catch (_) { r = null; }
    }
    if (!r || typeof r !== 'object' || Array.isArray(r)) r = {};
    return {
      autoCollapse: typeof r.autoCollapse === 'boolean' ? r.autoCollapse : DEFAULT_EARLY.autoCollapse,
      openPastChats: normalizeOpenPast(r.openPastChats),
      hideSources: typeof r.hideSources === 'boolean' ? r.hideSources : DEFAULT_EARLY.hideSources
    };
  }

  function readEarlyMirror(storage) {
    if (!storage || typeof storage.getItem !== 'function') return parseEarlyMirror(null);
    try {
      return parseEarlyMirror(storage.getItem(EARLY_STORAGE_KEY));
    } catch (_) {
      return parseEarlyMirror(null);
    }
  }

  function writeEarlyMirror(settings, storage) {
    const cfg = parseEarlyMirror(settings);
    if (storage && typeof storage.setItem === 'function') {
      try {
        storage.setItem(EARLY_STORAGE_KEY, JSON.stringify(cfg));
      } catch (_) { /* ignore storage errors */ }
    }
    return cfg;
  }

  function buildPrewrapCss(openPastChats, autoCollapse) {
    if (autoCollapse === false) return '';
    const past = normalizeOpenPast(openPastChats);
    const nth = 1 + past + 1;
    return (
      'html.gopt-prewrap .conversation-container:not([data-gopt-turn]):nth-last-child(n + ' + nth + ' of .conversation-container),\n' +
      'html.gopt-prewrap [data-test-id="conversation-turn"]:not([data-gopt-turn]):nth-last-child(n + ' + nth + ' of [data-test-id="conversation-turn"]) {\n' +
      '  content-visibility: hidden !important;\n' +
      '  contain: layout style paint !important;\n' +
      '  contain-intrinsic-size: 0 44px !important;\n' +
      '  height: 44px !important;\n' +
      '  min-height: 0 !important;\n' +
      '  margin-top: 0 !important;\n' +
      '  margin-bottom: 0 !important;\n' +
      '  padding-top: 0 !important;\n' +
      '  padding-bottom: 0 !important;\n' +
      '  overflow: hidden !important;\n' +
      '}'
    );
  }

  function shouldUseImmediateRefresh(ctx) {
    return Boolean(ctx && (ctx.coldLoading || (ctx.turnCount === 0 && ctx.hasElementMutation)));
  }

  function toggleClass(html, cls, on) {
    if (!html || !html.classList) return;
    if (html.classList.contains(cls) !== on) html.classList.toggle(cls, on);
  }

  function applyPrewrap(doc, settings) {
    const d = doc || root.document;
    if (!d || !d.documentElement) return null;
    const cfg = parseEarlyMirror(settings);
    const css = buildPrewrapCss(cfg.openPastChats, cfg.autoCollapse);
    const html = d.documentElement;
    toggleClass(html, 'gopt-prewrap', css.length > 0);
    toggleClass(html, 'gopt-hide-sources', cfg.hideSources);
    toggleClass(html, 'gopt-light-render', true);

    let styleEl = typeof d.getElementById === 'function' ? d.getElementById(PREWRAP_STYLE_ID) : null;
    if (css.length > 0) {
      if (!styleEl && typeof d.createElement === 'function') {
        styleEl = d.createElement('style');
        styleEl.id = PREWRAP_STYLE_ID;
        if (typeof styleEl.setAttribute === 'function') styleEl.setAttribute('data-gopt-owned', '');
      }
      if (styleEl) {
        if (styleEl.textContent !== css) styleEl.textContent = css;
        const host = d.head || d.documentElement;
        if (!styleEl.parentNode && host && typeof host.appendChild === 'function') {
          host.appendChild(styleEl);
        }
      }
    } else if (styleEl) {
      if (typeof styleEl.remove === 'function') styleEl.remove();
      else if (styleEl.parentNode && typeof styleEl.parentNode.removeChild === 'function') {
        styleEl.parentNode.removeChild(styleEl);
      }
    }
    return cfg;
  }

  function endColdLoad(doc, win) {
    const w = win || coldWin || root;
    if (coldTimer && w && typeof w.clearTimeout === 'function') {
      w.clearTimeout(coldTimer);
    }
    coldTimer = 0;
    coldWin = null;
    const d = doc || root.document;
    if (d && d.documentElement) toggleClass(d.documentElement, 'gopt-cold-loading', false);
  }

  function startColdLoad(doc, win, capMs) {
    const d = doc || root.document;
    const w = win || root;
    const ms = capMs === undefined || capMs === null ? COLD_LOAD_CAP_MS : Math.max(0, Number(capMs) || 0);
    if (coldTimer) {
      const prevWin = coldWin || w;
      if (prevWin && typeof prevWin.clearTimeout === 'function') prevWin.clearTimeout(coldTimer);
      coldTimer = 0;
    }
    if (d && d.documentElement) toggleClass(d.documentElement, 'gopt-cold-loading', true);
    if (w && typeof w.setTimeout === 'function') {
      coldWin = w;
      coldTimer = w.setTimeout(function () {
        coldTimer = 0;
        coldWin = null;
        if (d && d.documentElement) toggleClass(d.documentElement, 'gopt-cold-loading', false);
      }, ms);
    }
  }

  const isNodeEnv = (typeof module === 'object' && !!module.exports) ||
    (typeof process === 'object' && !!(process.versions && process.versions.node));
  if (!isNodeEnv && root.document && root.document.documentElement) {
    let ls = null;
    try { ls = root.localStorage; } catch (_) { ls = null; }
    applyPrewrap(root.document, readEarlyMirror(ls));
    startColdLoad(root.document, root, COLD_LOAD_CAP_MS);
  }

  return Object.freeze({
    EARLY_STORAGE_KEY, PREWRAP_STYLE_ID, COLD_LOAD_CAP_MS, DEFAULT_EARLY,
    parseEarlyMirror, readEarlyMirror, writeEarlyMirror,
    buildPrewrapCss, shouldUseImmediateRefresh,
    applyPrewrap, startColdLoad, endColdLoad
  });
});
