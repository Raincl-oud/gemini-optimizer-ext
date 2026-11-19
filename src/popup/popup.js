/* Gemini Optimizer popup controller. Settings go through chrome.storage; messages are only for status/actions. */
(function () {
  'use strict';

  const Settings = window.GeminiOptSettings;
  const GEMINI_URL = /^https:\/\/gemini\.google\.com\//;
  const POLL_MS = 1500;

  const $ = function (sel) { return document.querySelector(sel); };
  const pill = $('#status-pill');
  const statusText = $('#status-text');
  const actionButtons = Array.from(document.querySelectorAll('.action'));
  const switches = Array.from(document.querySelectorAll('.group > .row > .switch'));
  const textFullWidthBtn = $('#textFullWidth');
  const openPastWrap = $('#openPastChats-wrap');
  const openPastInput = $('#openPastChats');
  const openPastDec = $('#openPastDec');
  const openPastInc = $('#openPastInc');
  const accTrigger = $('#textOpt-trigger');
  const accPanel = $('#textOpt-panel');
  const accMeta = $('#textOpt-meta');
  const contentWidthWrap = $('#contentWidth-wrap');
  const contentWidthEl = $('#contentWidth');
  const contentWidthVal = $('#contentWidth-val');
  const fontGroup = $('#fontFamily');
  const resetTextBtn = $('#resetTextOpt');

  const SLIDERS = {
    fontSize: { el: $('#fontSize'), out: $('#fontSize-val'), neutral: 16, fmt: function (v) { return v + 'px'; } },
    lineHeight: { el: $('#lineHeight'), out: $('#lineHeight-val'), neutral: 1.6, fmt: function (v) { return Number(v).toFixed(2); } },
    paragraphGap: { el: $('#paragraphGap'), out: $('#paragraphGap-val'), neutral: 12, fmt: function (v) { return v + 'px'; } },
    letterSpacing: {
      el: $('#letterSpacing'),
      out: $('#letterSpacing-val'),
      neutral: 0,
      fmt: function (v) { return (v > 0 ? '+' : '') + Number(v).toFixed(2) + 'em'; }
    }
  };
  const FONT_LABELS = { sans: 'Sans', serif: 'Serif', mono: 'Mono' };

  let settings = Settings.normalizeSettings();
  let tab = null;
  let supported = false;
  let pollTimer = 0;
  let refreshTimer = 0;
  let sliderSaveTimer = 0;
  let pendingTextOpt = null;

  // ---------- rendering ----------
  function setPill(text, stateName, isStreaming) {
    if (statusText.textContent !== text) statusText.textContent = text;
    pill.dataset.state = stateName;
    pill.classList.toggle('is-streaming', !!isStreaming);
  }

  function renderSegmented(group, value) {
    const buttons = Array.from(group.querySelectorAll('[role="radio"]'));
    let idx = buttons.findIndex(function (b) { return b.dataset.value === String(value); });
    if (idx < 0) idx = 0;
    buttons.forEach(function (b, i) {
      b.setAttribute('aria-checked', i === idx ? 'true' : 'false');
      b.tabIndex = i === idx ? 0 : -1;
    });
    const ind = group.querySelector('.seg-indicator');
    if (ind) ind.style.transform = 'translateX(' + idx * 100 + '%)';
  }

  function renderTextOpt(t) {
    const full = t.fullWidth !== false;
    textFullWidthBtn.setAttribute('aria-checked', full ? 'true' : 'false');
    contentWidthWrap.classList.toggle('is-open', full);
    contentWidthWrap.inert = !full;
    contentWidthWrap.setAttribute('aria-hidden', full ? 'false' : 'true');
    const cw = t.contentWidth !== undefined && t.contentWidth !== null ? t.contentWidth : 100;
    contentWidthEl.value = String(cw);
    contentWidthVal.textContent = cw + '%';
    if (cw === 100) contentWidthVal.dataset.unset = 'true';
    else delete contentWidthVal.dataset.unset;
    contentWidthEl.style.backgroundSize = Math.round(((cw - 60) / 40) * 100) + '% 100%';

    renderSegmented(fontGroup, t.fontFamily);
    const typoActive = [];
    if (t.fontFamily !== 'default') typoActive.push(FONT_LABELS[t.fontFamily] || t.fontFamily);
    for (const key of Object.keys(SLIDERS)) {
      const cfg = SLIDERS[key];
      const v = t[key];
      if (v === null || v === undefined) {
        cfg.el.value = String(cfg.neutral);
        cfg.el.dataset.unset = 'true';
        cfg.out.textContent = 'Default';
        cfg.out.dataset.unset = 'true';
        cfg.el.style.backgroundSize = '0% 100%';
      } else {
        cfg.el.value = String(v);
        delete cfg.el.dataset.unset;
        const label = cfg.fmt(v);
        cfg.out.textContent = label;
        delete cfg.out.dataset.unset;
        const min = Number(cfg.el.min), max = Number(cfg.el.max);
        const pct = Math.round(((Number(cfg.el.value) - min) / (max - min)) * 100);
        cfg.el.style.backgroundSize = pct + '% 100%';
        typoActive.push(label);
      }
    }
    if (typoActive.length > 0) {
      accMeta.textContent = typoActive.length <= 2 ? typoActive.join(' \u00b7 ') : typoActive.length + ' custom';
      accMeta.classList.add('is-custom');
    } else if (!full) {
      accMeta.textContent = 'Standard width';
      accMeta.classList.add('is-custom');
    } else if (cw < 100) {
      accMeta.textContent = cw + '% width';
      accMeta.classList.add('is-custom');
    } else {
      accMeta.textContent = 'Default';
      accMeta.classList.remove('is-custom');
    }
    resetTextBtn.disabled = typoActive.length === 0;
  }

  function render(s) {
    settings = s;
    for (const sw of switches) sw.setAttribute('aria-checked', s[sw.id] ? 'true' : 'false');
    openPastWrap.classList.toggle('is-open', !!s.autoCollapse);
    openPastWrap.inert = !s.autoCollapse;
    openPastWrap.setAttribute('aria-hidden', s.autoCollapse ? 'false' : 'true');
    if (document.activeElement !== openPastInput) {
      openPastInput.value = String(s.openPastChats);
    }
    openPastDec.disabled = s.openPastChats <= Settings.OPEN_PAST_CHATS_MIN;
    openPastInc.disabled = s.openPastChats >= Settings.OPEN_PAST_CHATS_MAX;
    renderTextOpt(s.textOpt || Settings.DEFAULT_TEXT_OPT);
  }

  function renderUnsupported(text) {
    setPill(text || 'Open gemini.google.com', 'unsupported', false);
    for (const b of actionButtons) b.disabled = true;
  }

  function renderStatus(st) {
    if (!st) return renderUnsupported('Reload Gemini tab');
    const noun = st.totalTurns === 1 ? 'Past Chat' : 'Past Chats';
    let text = st.totalTurns + ' ' + noun + ' \u00b7 ' + st.collapsedTurns + ' wrapped';
    if (st.sourcesHidden) text += ' \u00b7 Sources hidden';
    if (st.streaming) text += ' \u00b7 Responding';
    setPill(text, 'ready', !!st.streaming);
    for (const b of actionButtons) {
      const act = b.dataset.action;
      b.disabled = (act === 'expandAll' && st.collapsedTurns === 0) ||
                   (act === 'collapseOld' && st.totalTurns <= 1);
    }
    if (st.theme === 'dark' || st.theme === 'light') document.documentElement.dataset.theme = st.theme;
  }

  // ---------- messaging ----------
  function send(msg) {
    return new Promise(function (resolve) {
      if (!tab || tab.id === undefined) return resolve(null);
      try {
        chrome.tabs.sendMessage(tab.id, msg, function (res) {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(res || null);
        });
      } catch (_) { resolve(null); }
    });
  }

  function refreshStatus() {
    if (!supported) return renderUnsupported();
    send({ type: 'GET_STATUS' }).then(function (res) {
      if (res && res.ok) renderStatus(res.status);
      else renderUnsupported('Reload Gemini tab');
    });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshStatus, 200);
  }

  // ---------- interactions ----------
  function savePatch(patch) {
    const optimistic = Object.assign({}, settings, patch);
    if (patch.textOpt) optimistic.textOpt = Object.assign({}, settings.textOpt, patch.textOpt);
    render(Settings.normalizeSettings(optimistic));
    return Settings.saveSettings(patch).then(function (next) {
      render(pendingTextOpt
        ? Settings.normalizeSettings(Object.assign({}, next, { textOpt: Object.assign({}, next.textOpt, pendingTextOpt) }))
        : next);
      scheduleRefresh();
      return next;
    });
  }

  function flushPendingTextOpt() {
    clearTimeout(sliderSaveTimer);
    sliderSaveTimer = 0;
    const toSave = pendingTextOpt;
    pendingTextOpt = null;
    if (!toSave) return;
    Settings.saveSettings({ textOpt: toSave }).then(function (next) {
      render(pendingTextOpt
        ? Settings.normalizeSettings(Object.assign({}, next, { textOpt: Object.assign({}, next.textOpt, pendingTextOpt) }))
        : next);
      scheduleRefresh();
    });
  }

  function saveTextOptPatch(patch, debounceMs) {
    pendingTextOpt = Object.assign(pendingTextOpt || {}, patch);
    const optimistic = Object.assign({}, settings, {
      textOpt: Object.assign({}, settings.textOpt, pendingTextOpt)
    });
    render(Settings.normalizeSettings(optimistic));
    clearTimeout(sliderSaveTimer);
    if (debounceMs > 0) sliderSaveTimer = setTimeout(flushPendingTextOpt, debounceMs);
    else flushPendingTextOpt();
  }

  function commitOpenPast(normalizeField) {
    const raw = openPastInput.value.trim();
    if (raw === '' || !/^-?\d+$/.test(raw)) {
      if (normalizeField) openPastInput.value = String(settings.openPastChats);
      return;
    }
    const next = Settings.normalizeSettings({ openPastChats: Number(raw) }).openPastChats;
    if (normalizeField) openPastInput.value = String(next);
    if (next !== settings.openPastChats) savePatch({ openPastChats: next });
  }

  function onAction(btn) {
    btn.disabled = true;
    send({ type: 'RUN_ACTION', action: btn.dataset.action }).then(function (res) {
      if (res && res.ok) {
        renderStatus(res.status);
        btn.classList.add('is-done');
        setTimeout(function () { btn.classList.remove('is-done'); }, 450);
      } else {
        renderUnsupported('Reload Gemini tab');
      }
    });
  }

  function bind() {
    for (const sw of switches) {
      sw.addEventListener('click', function () {
        savePatch((function (k, v) { const o = {}; o[k] = v; return o; })(sw.id, sw.getAttribute('aria-checked') !== 'true'));
      });
    }
    textFullWidthBtn.addEventListener('click', function () {
      saveTextOptPatch({ fullWidth: textFullWidthBtn.getAttribute('aria-checked') !== 'true' }, 0);
    });
    contentWidthEl.addEventListener('input', function () {
      saveTextOptPatch({ contentWidth: Number(contentWidthEl.value) }, 60);
    });
    contentWidthEl.addEventListener('change', function () {
      saveTextOptPatch({ contentWidth: Number(contentWidthEl.value) }, 0);
    });

    openPastDec.addEventListener('click', function () {
      savePatch({ openPastChats: Math.max(Settings.OPEN_PAST_CHATS_MIN, settings.openPastChats - 1) });
    });
    openPastInc.addEventListener('click', function () {
      savePatch({ openPastChats: Math.min(Settings.OPEN_PAST_CHATS_MAX, settings.openPastChats + 1) });
    });
    openPastInput.addEventListener('input', function () { commitOpenPast(false); });
    openPastInput.addEventListener('change', function () { commitOpenPast(true); });
    openPastInput.addEventListener('blur', function () { commitOpenPast(true); });

    accTrigger.addEventListener('click', function () {
      const open = accTrigger.getAttribute('aria-expanded') !== 'true';
      accTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      accPanel.classList.toggle('is-open', open);
      accPanel.inert = !open;
      accPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
    });

    const fontButtons = Array.from(fontGroup.querySelectorAll('[role="radio"]'));
    fontButtons.forEach(function (b, i) {
      b.addEventListener('click', function () { saveTextOptPatch({ fontFamily: b.dataset.value }, 0); });
      b.addEventListener('keydown', function (ev) {
        let next = -1;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (i + 1) % fontButtons.length;
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (i - 1 + fontButtons.length) % fontButtons.length;
        if (next < 0) return;
        ev.preventDefault();
        fontButtons[next].focus();
        saveTextOptPatch({ fontFamily: fontButtons[next].dataset.value }, 0);
      });
    });

    for (const key of Object.keys(SLIDERS)) {
      const cfg = SLIDERS[key];
      const patchFor = function () {
        const p = {};
        p[key] = Number(cfg.el.value);
        return p;
      };
      cfg.el.addEventListener('input', function () { saveTextOptPatch(patchFor(), 60); });
      cfg.el.addEventListener('change', function () { saveTextOptPatch(patchFor(), 0); });
    }

    resetTextBtn.addEventListener('click', function () {
      saveTextOptPatch(Object.assign({}, Settings.DEFAULT_TYPOGRAPHY_RESET), 0);
    });

    for (const b of actionButtons) b.addEventListener('click', function () { onAction(b); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushPendingTextOpt();
    });
    window.addEventListener('pagehide', flushPendingTextOpt);
    window.addEventListener('unload', function () {
      flushPendingTextOpt();
      clearInterval(pollTimer);
      clearTimeout(refreshTimer);
    });
  }

  async function init() {
    try {
      if (window.chrome && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
        const m = chrome.runtime.getManifest();
        if (m && m.version) $('#ext-version').textContent = 'v' + m.version;
      }
    } catch (_) { /* ignore when getManifest absent */ }
    bind();
    settings = await Settings.loadSettings();
    render(settings);
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs && tabs[0] ? tabs[0] : null;
    } catch (_) { tab = null; }
    supported = !!(tab && GEMINI_URL.test(tab.url || ''));
    refreshStatus();
    pollTimer = setInterval(refreshStatus, POLL_MS);
  }

  init();
})();
