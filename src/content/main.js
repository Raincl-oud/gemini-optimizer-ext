/* Gemini Web Optimizer - content orchestrator (no exports). */
(function () {
  'use strict';
  if (window.__goptBooted) return;
  window.__goptBooted = true;

  const Settings = window.GeminiOptSettings;
  const Selectors = window.GeminiOptSelectors;
  const Collapse = window.GeminiOptCollapse;
  const Navigator = window.GeminiOptNavigator;
  const Folders = window.GeminiOptFolders;
  const TokenTracker = window.GeminiOptTokenTracker;
  const Early = window.GeminiOptEarly;
  if (!Settings || !Selectors || !Collapse || !Navigator) {
    window.__goptBooted = false;
    return;
  }

  const DEBOUNCE_MS = 150;
  const MAX_WAIT_MS = 600;
  const HEAVY_DEBOUNCE_MS = 500;
  const HEAVY_MAX_WAIT_MS = 900;
  const WAIT_CHAT_MS = 30000;
  const ROUTE_POLL_MS = 700;
  const COLD_LOAD_MS = 500;
  const COLD_SETTLE_MS = 350;
  const STREAM_WATCH_MS = 450;
  const HEAVY_STREAM_WATCH_MS = 650;
  const SCROLL_IDLE_MS = 120;
  const LATEX_HEAVY_THRESHOLD = 50;
  const html = document.documentElement;

  const state = {
    settings: Settings.normalizeSettings(),
    chatRoot: null,
    scrollEl: null,
    scrollBtn: null,
    scrollBtnRaf: 0,
    scrollBtnTrackRaf: 0,
    scrollBtnTrackUntil: 0,
    scrollBtnRo: null,
    scrollBtnRoTargets: [],
    scrollBtnPosDirty: true,
    scrollBtnVisible: false,
    widthAnimTimer: 0,
    routeTimer: 0,
    lastBtnPos: '',
    observer: null,
    themeObserver: null,
    bodyObserver: null,
    bodyTimeout: 0,
    refreshTimer: 0,
    refreshRaf: 0,
    streamWatchTimer: 0,
    coldLoading: true,
    coldSettleTimer: 0,
    idleTagHandle: 0,
    idleTagKind: '',
    pendingTagTurns: new Set(),
    firstScheduledAt: 0,
    href: location.href,
    turnCount: 0,
    streaming: false,
    latexHeavy: false,
    scrolling: false,
    scrollShieldEl: null,
    scrollIdleTimer: 0,
    pointerDownBound: false,
    scrollIdleCallbacks: new Set(),
    pendingTokenArgs: null,
    lastTokenUpdateAt: 0,
    forceTagAll: false,
    seenTurns: new WeakSet()
  };

  function safeLocalStorage() {
    try { return window.localStorage || null; } catch (_) { return null; }
  }

  function syncEarlyMirror() {
    if (!Early) return;
    Early.writeEarlyMirror(state.settings, safeLocalStorage());
    Early.applyPrewrap(document, state.settings);
  }

  function finishColdLoadWindow() {
    clearTimeout(state.coldSettleTimer);
    state.coldSettleTimer = 0;
    state.coldLoading = false;
    if (Early) Early.endColdLoad(document, window);
    else toggle('gopt-cold-loading', false);
  }

  function beginColdLoadWindow(ms) {
    const dur = ms || (Early ? Early.COLD_LOAD_CAP_MS : COLD_LOAD_MS);
    state.coldLoading = true;
    clearTimeout(state.coldSettleTimer);
    if (Early) Early.startColdLoad(document, window, dur);
    else toggle('gopt-cold-loading', true);
    state.coldSettleTimer = setTimeout(finishColdLoadWindow, dur);
  }

  function cancelDeferredTagging() {
    if (state.idleTagHandle) {
      if (state.idleTagKind === 'idle' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(state.idleTagHandle);
      } else {
        clearTimeout(state.idleTagHandle);
      }
      state.idleTagHandle = 0;
      state.idleTagKind = '';
    }
    state.pendingTagTurns.clear();
  }

  function flushDeferredTagging() {
    state.idleTagHandle = 0;
    state.idleTagKind = '';
    if (!state.chatRoot || !state.chatRoot.isConnected || !state.settings.hideSources) {
      state.pendingTagTurns.clear();
      return;
    }
    const turns = Selectors.getTurns(state.chatRoot);
    const lastTurn = turns.length ? turns[turns.length - 1] : null;
    const batch = [];
    for (const t of state.pendingTagTurns) {
      if (t && t.isConnected && !(state.streaming && t === lastTurn)) batch.push(t);
    }
    state.pendingTagTurns.clear();
    if (batch.length) Selectors.tagDynamicAttributionNodes(batch);
  }

  function scheduleDeferredTagging(turnsList) {
    if (turnsList) {
      for (const t of turnsList) if (t) state.pendingTagTurns.add(t);
    }
    if (!state.pendingTagTurns.size || state.idleTagHandle) return;
    if (typeof window.requestIdleCallback === 'function') {
      state.idleTagKind = 'idle';
      state.idleTagHandle = window.requestIdleCallback(flushDeferredTagging, { timeout: 300 });
    } else {
      state.idleTagKind = 'timeout';
      state.idleTagHandle = setTimeout(flushDeferredTagging, 32);
    }
  }

  function sameElements(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function toggle(cls, on) {
    if (html.classList.contains(cls) !== on) html.classList.toggle(cls, on);
  }

  function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function animOk() {
    return !prefersReduced();
  }

  function setRootVar(cls, active, varName, val) {
    toggle(cls, active);
    if (active) document.documentElement.style.setProperty(varName, val);
    else document.documentElement.style.removeProperty(varName);
  }

  function applyTextOpt() {
    state.scrollBtnPosDirty = true;
    const t = state.settings.textOpt || Settings.DEFAULT_TEXT_OPT;
    const fullActive = t.fullWidth !== false && state.turnCount > 0;
    const cw = t.contentWidth !== undefined && t.contentWidth !== null ? t.contentWidth : 100;
    setRootVar('gopt-text-fullwidth', fullActive, '--gopt-content-width', cw + '%');
    toggle('gopt-font-sans', t.fontFamily === 'sans');
    toggle('gopt-font-serif', t.fontFamily === 'serif');
    toggle('gopt-font-mono', t.fontFamily === 'mono');
    setRootVar('gopt-text-size', t.fontSize !== null, '--gopt-font-size', t.fontSize + 'px');
    setRootVar('gopt-text-lh', t.lineHeight !== null, '--gopt-line-height', String(t.lineHeight));
    setRootVar('gopt-text-gap', t.paragraphGap !== null, '--gopt-paragraph-gap', t.paragraphGap + 'px');
    setRootVar('gopt-text-ls', t.letterSpacing !== null, '--gopt-letter-spacing', t.letterSpacing + 'em');
  }

  function applyRootClasses() {
    toggle('gopt-active', true);
    toggle('gopt-light-render', true);
    toggle('gopt-hide-sources', state.settings.hideSources);
    toggle('gopt-lite-latex', !!state.settings.liteLatex);
    toggle('gopt-folders-active', state.settings.showFolders !== false);
    toggle('gopt-dark', Selectors.detectTheme(document) === 'dark');
    applyTextOpt();
  }

  // ---------- circular Scroll to bottom button (54x54 px) ----------
  function scroller() {
    return state.chatRoot || Selectors.findChatScroller(document);
  }

  function ensureScrollBtn() {
    if (state.scrollBtn || !document.body) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gopt-scroll-bottom-btn';
    btn.setAttribute('data-gopt-owned', '');
    btn.setAttribute('aria-label', 'Scroll to bottom');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ['M12 5v14', 'M19 12l-7 7-7-7']) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    btn.appendChild(svg);
    btn.addEventListener('click', function () {
      const sc = scroller();
      if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: animOk() ? 'smooth' : 'auto' });
    });
    document.body.appendChild(btn);
    state.scrollBtn = btn;
  }

  function clearScrollShield() {
    clearTimeout(state.scrollIdleTimer);
    state.scrollIdleTimer = 0;
    if (!state.scrolling) return;
    state.scrolling = false;
    if (state.scrollShieldEl) state.scrollShieldEl.removeAttribute('data-gopt-scrolling');
    if (state.pendingTokenArgs && TokenTracker) {
      const args = state.pendingTokenArgs;
      state.pendingTokenArgs = null;
      state.lastTokenUpdateAt = Date.now();
      TokenTracker.update(args);
    }
    const cbs = Array.from(state.scrollIdleCallbacks);
    state.scrollIdleCallbacks.clear();
    for (const cb of cbs) {
      try { cb(); } catch (_) { /* ignore */ }
    }
  }

  function onScrollActivity() {
    if (!state.scrolling) {
      state.scrolling = true;
      if (state.scrollShieldEl) state.scrollShieldEl.setAttribute('data-gopt-scrolling', '1');
    }
    clearTimeout(state.scrollIdleTimer);
    state.scrollIdleTimer = setTimeout(clearScrollShield, SCROLL_IDLE_MS);
  }

  function onScrollIdle(cb) {
    if (typeof cb !== 'function') return function () {};
    if (!state.scrolling) {
      cb();
      return function () {};
    }
    state.scrollIdleCallbacks.add(cb);
    return function () { state.scrollIdleCallbacks.delete(cb); };
  }

  function attachScrollShield(el) {
    if (state.scrollShieldEl !== el) {
      if (state.scrollShieldEl) {
        state.scrollShieldEl.removeEventListener('scroll', onScrollActivity);
        state.scrollShieldEl.removeEventListener('wheel', onScrollActivity);
        state.scrollShieldEl.removeAttribute('data-gopt-scrolling');
      }
      clearScrollShield();
      state.scrollShieldEl = el || null;
      if (state.scrollShieldEl) {
        state.scrollShieldEl.addEventListener('scroll', onScrollActivity, { passive: true });
        state.scrollShieldEl.addEventListener('wheel', onScrollActivity, { passive: true });
      }
    }
    if (el && !state.pointerDownBound) {
      document.addEventListener('pointerdown', clearScrollShield, { passive: true });
      state.pointerDownBound = true;
    }
  }

  function updateScrollBtn() {
    state.scrollBtnRaf = 0;
    ensureScrollBtn();
    const btn = state.scrollBtn;
    if (!btn) return;
    const sc = scroller();
    if (!sc || !sc.isConnected) {
      state.scrollBtnVisible = false;
      btn.classList.remove('is-visible');
      return;
    }
    const dist = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
    const show = dist > 80;
    const wasVisible = state.scrollBtnVisible;
    state.scrollBtnVisible = show;
    btn.classList.toggle('is-visible', show);
    if (!show) return;
    if (!state.scrollBtnPosDirty && state.lastBtnPos && wasVisible) return;

    const fullW = html.classList.contains('gopt-text-fullwidth');
    const fallbackPad = fullW ? 44 : 16;
    const anchor = Selectors.findComposerAnchor(document);
    let left = fallbackPad;
    let top = window.innerHeight - 110;
    if (anchor) {
      const cr = anchor.getBoundingClientRect();
      if (cr.width > 0 && cr.height > 0) {
        const box = anchor.querySelector('.text-input-field, rich-textarea');
        const br = box ? box.getBoundingClientRect() : null;
        left = br && br.width > 0 ? Math.round(br.left) : Math.round(cr.left + fallbackPad);
        top = Math.round(cr.top - 62);
      } else {
        const sr = sc.getBoundingClientRect();
        left = Math.round(sr.left + fallbackPad);
        top = Math.round(sr.bottom - 66);
      }
    } else {
      const sr = sc.getBoundingClientRect();
      left = Math.round(sr.left + fallbackPad);
      top = Math.round(sr.bottom - 66);
    }
    left = Math.max(16, Math.min(window.innerWidth - 62, left));
    top = Math.max(8, Math.min(window.innerHeight - 62, top));
    state.scrollBtnPosDirty = false;
    const key = left + '|' + top;
    if (key !== state.lastBtnPos) {
      state.lastBtnPos = key;
      btn.style.left = left + 'px';
      btn.style.top = top + 'px';
    }
  }

  function scheduleScrollBtnUpdate() {
    if (state.scrollBtnRaf) return;
    state.scrollBtnRaf = requestAnimationFrame(updateScrollBtn);
  }

  function onWindowResize() {
    state.scrollBtnPosDirty = true;
    scheduleScrollBtnUpdate();
  }

  function startScrollBtnTrack(durationMs) {
    state.scrollBtnPosDirty = true;
    const now = performance.now();
    const until = now + (durationMs || 360);
    if (until > state.scrollBtnTrackUntil) state.scrollBtnTrackUntil = until;
    if (state.scrollBtnTrackRaf) return;
    const step = function () {
      state.scrollBtnTrackRaf = 0;
      state.scrollBtnPosDirty = true;
      updateScrollBtn();
      if (performance.now() < state.scrollBtnTrackUntil) {
        state.scrollBtnTrackRaf = requestAnimationFrame(step);
      }
    };
    state.scrollBtnTrackRaf = requestAnimationFrame(step);
  }

  function attachScrollBtnObservers() {
    const sc = scroller();
    if (sc !== state.scrollEl) {
      if (state.scrollEl) state.scrollEl.removeEventListener('scroll', scheduleScrollBtnUpdate);
      state.scrollEl = sc;
      if (state.scrollEl) state.scrollEl.addEventListener('scroll', scheduleScrollBtnUpdate, { passive: true });
    }
    if (typeof ResizeObserver === 'function') {
      if (!state.scrollBtnRo) {
        state.scrollBtnRo = new ResizeObserver(function () {
          state.scrollBtnPosDirty = true;
          startScrollBtnTrack(360);
        });
      }
      const next = [
        sc,
        Selectors.findComposerAnchor(document),
        Selectors.queryFirst(document, Selectors.SEL.mainArea),
        Selectors.queryFirst(document, Selectors.SEL.sidenav)
      ].filter(Boolean);
      if (!sameElements(state.scrollBtnRoTargets, next)) {
        state.scrollBtnRo.disconnect();
        state.scrollBtnRoTargets = next;
        for (const el of next) state.scrollBtnRo.observe(el);
      }
    }
  }

  function cancelRefreshRaf() {
    if (!state.refreshRaf) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.refreshRaf);
    else clearTimeout(state.refreshRaf);
    state.refreshRaf = 0;
  }

  // ---------- refresh ----------
  function refresh() {
    state.refreshTimer = 0;
    clearTimeout(state.streamWatchTimer);
    state.streamWatchTimer = 0;
    cancelRefreshRaf();
    state.firstScheduledAt = 0;
    if (!state.chatRoot || !state.chatRoot.isConnected) {
      attachToChat();
      return;
    }
    const turns = Selectors.getTurns(state.chatRoot);
    const prevTurnCount = state.turnCount;
    const wasEmpty = prevTurnCount === 0;
    state.turnCount = turns.length;
    applyTextOpt();
    if (wasEmpty && turns.length > 0 && state.coldLoading) {
      beginColdLoadWindow(COLD_SETTLE_MS);
    }
    const lastIdx = turns.length - 1;
    const wasStreaming = state.streaming;
    state.streaming = lastIdx >= 0 && Selectors.isTurnStreaming(turns[lastIdx], true, document);
    if (!state.scrolling && (turns.length !== prevTurnCount || state.forceTagAll || !state.streaming)) {
      const katexCount = state.chatRoot.querySelectorAll ? state.chatRoot.querySelectorAll('.katex').length : 0;
      state.latexHeavy = katexCount >= LATEX_HEAVY_THRESHOLD;
      toggle('gopt-latex-heavy', state.latexHeavy);
    }
    if (state.streaming) {
      state.streamWatchTimer = setTimeout(refresh, state.latexHeavy ? HEAVY_STREAM_WATCH_MS : STREAM_WATCH_MS);
    }
    const states = Collapse.sync(turns, state.settings, { streamingIndex: state.streaming ? lastIdx : -1 });
    Navigator.update(turns, states);
    if (TokenTracker) {
      const tokenArgs = {
        turns: turns,
        streaming: state.streaming,
        wasStreaming: wasStreaming,
        url: location.href,
        doc: document
      };
      const now = Date.now();
      if (state.scrolling && !wasEmpty && !(wasStreaming && !state.streaming) && (now - state.lastTokenUpdateAt < 500)) {
        state.pendingTokenArgs = tokenArgs;
      } else {
        state.pendingTokenArgs = null;
        state.lastTokenUpdateAt = now;
        TokenTracker.update(tokenArgs);
      }
    }

    if (state.settings.hideSources) {
      const finishedStreaming = wasStreaming && !state.streaming && lastIdx >= 0;
      const changed = state.forceTagAll
        ? turns.filter(function (_t, i) { return !(state.streaming && i === lastIdx); })
        : turns.filter(function (t, i) {
            if (state.streaming && i === lastIdx) return false;
            return !state.seenTurns.has(t) || i >= lastIdx - 1 || (finishedStreaming && i === lastIdx);
          });
      state.forceTagAll = false;
      if (changed.length) {
        if (wasEmpty || state.coldLoading || changed.length > 8) {
          scheduleDeferredTagging(changed);
        } else {
          Selectors.tagDynamicAttributionNodes(changed);
        }
      }
    }
    for (let i = 0; i < turns.length; i++) {
      if (!state.streaming || i !== lastIdx) state.seenTurns.add(turns[i]);
    }
    attachScrollBtnObservers();
    scheduleScrollBtnUpdate();
  }

  function refreshNow() {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = 0;
    clearTimeout(state.streamWatchTimer);
    state.streamWatchTimer = 0;
    cancelRefreshRaf();
    refresh();
  }

  function scheduleRefresh(hasElementMutation) {
    const immediate = Early
      ? Early.shouldUseImmediateRefresh({
          coldLoading: state.coldLoading,
          turnCount: state.turnCount,
          hasElementMutation: !!hasElementMutation
        })
      : (state.coldLoading || (state.turnCount === 0 && !!hasElementMutation));
    if (immediate) {
      clearTimeout(state.refreshTimer);
      state.refreshTimer = 0;
      if (!state.refreshRaf) {
        if (typeof requestAnimationFrame === 'function') {
          state.refreshRaf = requestAnimationFrame(refresh);
        } else {
          state.refreshRaf = setTimeout(refresh, 0);
        }
      }
      return;
    }
    if (state.refreshRaf) return;
    const now = Date.now();
    if (!state.firstScheduledAt) state.firstScheduledAt = now;
    clearTimeout(state.refreshTimer);
    const heavyStreaming = state.latexHeavy && state.streaming;
    const debounceMs = heavyStreaming ? HEAVY_DEBOUNCE_MS : DEBOUNCE_MS;
    const maxWaitMs = heavyStreaming ? HEAVY_MAX_WAIT_MS : MAX_WAIT_MS;
    const wait = Math.max(0, Math.min(debounceMs, state.firstScheduledAt + maxWaitMs - now));
    state.refreshTimer = setTimeout(refresh, wait);
  }

  function isOwned(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    return el.hasAttribute('data-gopt-owned') || (el.closest ? el.closest('[data-gopt-owned]') !== null : false);
  }

  function onMutations(records) {
    let hasNonOwned = false;
    let hasElementMutation = false;
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (!isOwned(n)) {
          hasNonOwned = true;
          if (n.nodeType === 1) { hasElementMutation = true; break; }
        }
      }
      if (hasElementMutation) break;
      for (const n of r.removedNodes) {
        if (!isOwned(n)) {
          hasNonOwned = true;
          if (n.nodeType === 1) { hasElementMutation = true; break; }
        }
      }
      if (hasElementMutation) break;
    }
    if (hasNonOwned) scheduleRefresh(hasElementMutation);
  }

  // ---------- chat attach ----------
  function stopWaiting() {
    if (state.bodyObserver) { state.bodyObserver.disconnect(); state.bodyObserver = null; }
    clearTimeout(state.bodyTimeout);
    state.bodyTimeout = 0;
  }

  function attachToChat() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    stopWaiting();
    const found = Selectors.findChatScroller(document);
    if (!found) {
      state.chatRoot = null;
      attachScrollShield(null);
      attachScrollBtnObservers();
      scheduleScrollBtnUpdate();
      if (TokenTracker) {
        TokenTracker.update({ turns: [], streaming: false, wasStreaming: false, url: location.href, doc: document });
      }
      state.bodyObserver = new MutationObserver(function () {
        if (Selectors.findChatScroller(document)) attachToChat();
      });
      state.bodyObserver.observe(document.body || html, { childList: true, subtree: true });
      state.bodyTimeout = setTimeout(stopWaiting, WAIT_CHAT_MS);
      return;
    }
    state.chatRoot = found;
    attachScrollShield(found);
    state.observer = new MutationObserver(onMutations);
    state.observer.observe(found, { childList: true, subtree: true, characterData: false });
    state.forceTagAll = true;
    refreshNow();
  }

  // ---------- navigation & lifecycle ----------
  function checkRoute() {
    if (location.href === state.href) return;
    state.href = location.href;
    state.turnCount = 0;
    state.streaming = false;
    state.latexHeavy = false;
    toggle('gopt-latex-heavy', false);
    state.lastBtnPos = '';
    state.scrollBtnPosDirty = true;
    state.scrollBtnVisible = false;
    state.pendingTokenArgs = null;
    clearScrollShield();
    attachScrollShield(null);
    clearTimeout(state.refreshTimer);
    state.refreshTimer = 0;
    clearTimeout(state.streamWatchTimer);
    state.streamWatchTimer = 0;
    cancelRefreshRaf();
    cancelDeferredTagging();
    beginColdLoadWindow(COLD_LOAD_MS);
    applyTextOpt();
    if (state.scrollBtn) state.scrollBtn.classList.remove('is-visible');
    Collapse.reset();
    Navigator.reset();
    if (Folders) Folders.updateRoute(location.href);
    if (TokenTracker) TokenTracker.resetRoute();
    attachToChat();
  }

  function watchNavigation() {
    const hasNavApi = !!(window.navigation && typeof window.navigation.addEventListener === 'function');
    if (hasNavApi) {
      window.navigation.addEventListener('navigatesuccess', checkRoute);
    }
    window.addEventListener('popstate', checkRoute);
    if (!hasNavApi) {
      state.routeTimer = setInterval(checkRoute, ROUTE_POLL_MS);
    }
  }

  function watchTheme() {
    state.themeObserver = new MutationObserver(function () {
      toggle('gopt-dark', Selectors.detectTheme(document) === 'dark');
    });
    const opts = { attributes: true, attributeFilter: ['class', 'data-theme', 'dark'] };
    state.themeObserver.observe(html, opts);
    if (document.body) state.themeObserver.observe(document.body, opts);
  }

  function cleanup(ev) {
    if (ev && ev.persisted) return;
    window.removeEventListener('pagehide', cleanup);
    stopWaiting();
    cancelDeferredTagging();
    finishColdLoadWindow();
    window.removeEventListener('resize', onWindowResize);
    if (state.pointerDownBound) {
      document.removeEventListener('pointerdown', clearScrollShield);
      state.pointerDownBound = false;
    }
    state.pendingTokenArgs = null;
    state.scrollIdleCallbacks.clear();
    attachScrollShield(null);
    state.latexHeavy = false;
    toggle('gopt-latex-heavy', false);
    toggle('gopt-folders-active', false);
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    if (state.themeObserver) { state.themeObserver.disconnect(); state.themeObserver = null; }
    if (state.scrollBtnRo) { state.scrollBtnRo.disconnect(); state.scrollBtnRo = null; }
    state.scrollBtnRoTargets = [];
    if (state.scrollEl) { state.scrollEl.removeEventListener('scroll', scheduleScrollBtnUpdate); state.scrollEl = null; }
    clearInterval(state.routeTimer); state.routeTimer = 0;
    clearTimeout(state.refreshTimer); state.refreshTimer = 0;
    clearTimeout(state.streamWatchTimer); state.streamWatchTimer = 0;
    cancelRefreshRaf();
    clearTimeout(state.widthAnimTimer); state.widthAnimTimer = 0;
    if (state.scrollBtnRaf) { cancelAnimationFrame(state.scrollBtnRaf); state.scrollBtnRaf = 0; }
    if (state.scrollBtnTrackRaf) { cancelAnimationFrame(state.scrollBtnTrackRaf); state.scrollBtnTrackRaf = 0; }
    Collapse.reset();
    Navigator.destroy();
    if (Folders) Folders.destroy();
    if (TokenTracker) TokenTracker.destroy();
  }

  // ---------- actions ----------
  function syncAfterCollapseChange(els, states) {
    if (els && els.length) Navigator.update(els, states);
    scheduleScrollBtnUpdate();
  }

  function goToTurn(el) {
    Collapse.expandTurn(el);
    refreshNow();
    requestAnimationFrame(function () {
      el.scrollIntoView({ block: 'start', behavior: animOk() ? 'smooth' : 'auto' });
      scheduleScrollBtnUpdate();
    });
  }

  function buildStatus() {
    const st = Collapse.getStats();
    return {
      supported: true,
      isChat: !!state.chatRoot,
      totalTurns: st.total,
      collapsedTurns: st.collapsed,
      openTurns: st.open,
      manualOpenTurns: st.manualOpen,
      streaming: state.streaming,
      sourcesHidden: state.settings.hideSources,
      lightRenderActive: true,
      animationsEnabled: animOk(),
      theme: Selectors.detectTheme(document),
      url: location.href
    };
  }

  function handleMessage(msg, _sender, sendResponse) {
    if (!msg || typeof msg !== 'object') {
      sendResponse({ ok: false, error: 'UNKNOWN_MESSAGE' });
      return false;
    }
    if (msg.type === 'GET_STATUS') {
      sendResponse({ ok: true, status: buildStatus() });
      return false;
    }
    if (msg.type === 'RUN_ACTION') {
      const behavior = animOk() ? 'smooth' : 'auto';
      const sc = scroller();
      switch (msg.action) {
        case 'expandAll': Collapse.expandAll(); refreshNow(); break;
        case 'collapseOld': Collapse.collapseOld(); refreshNow(); break;
        case 'scrollTop':
          if (!sc) { sendResponse({ ok: false, error: 'NOT_READY' }); return false; }
          sc.scrollTo({ top: 0, behavior: behavior });
          break;
        case 'scrollBottom':
          if (!sc) { sendResponse({ ok: false, error: 'NOT_READY' }); return false; }
          sc.scrollTo({ top: sc.scrollHeight, behavior: behavior });
          break;
        default:
          sendResponse({ ok: false, error: 'UNKNOWN_ACTION' });
          return false;
      }
      sendResponse({ ok: true, status: buildStatus() });
      return false;
    }
    sendResponse({ ok: false, error: 'UNKNOWN_MESSAGE' });
    return false;
  }

  // ---------- boot ----------
  async function boot() {
    beginColdLoadWindow(COLD_LOAD_MS);
    applyRootClasses();
    state.settings = await Settings.loadSettings();
    syncEarlyMirror();
    applyRootClasses();
    Navigator.mount(document);
    if (Folders) {
      Folders.setEnabled(state.settings.showFolders !== false);
      Folders.mount(document);
    }
    if (TokenTracker) {
      if (typeof TokenTracker.setScrollStateProvider === 'function') {
        TokenTracker.setScrollStateProvider(function () { return state.scrolling; }, onScrollIdle);
      }
      TokenTracker.setEnabled(state.settings.showTokenUsage !== false);
      TokenTracker.mount(document);
    }
    Navigator.onNavigate(goToTurn);
    Collapse.onStateChange(syncAfterCollapseChange);
    ensureScrollBtn();
    window.addEventListener('resize', onWindowResize, { passive: true });
    window.addEventListener('pagehide', cleanup);
    attachToChat();
    Settings.onSettingsChanged(function (next, prev) {
      if (next.hideSources && !prev.hideSources) state.forceTagAll = true;
      const prevFull = !(prev && prev.textOpt && prev.textOpt.fullWidth === false);
      const nextFull = !(next && next.textOpt && next.textOpt.fullWidth === false);
      const prevWidth = prev && prev.textOpt && prev.textOpt.contentWidth !== undefined ? prev.textOpt.contentWidth : 100;
      const nextWidth = next && next.textOpt && next.textOpt.contentWidth !== undefined ? next.textOpt.contentWidth : 100;
      const fullChanged = prevFull !== nextFull;
      const widthChanged = prevWidth !== nextWidth;
      if (fullChanged && animOk()) {
        toggle('gopt-width-animating', true);
        clearTimeout(state.widthAnimTimer);
        state.widthAnimTimer = setTimeout(function () {
          state.widthAnimTimer = 0;
          toggle('gopt-width-animating', false);
        }, 280);
      }
      state.settings = next;
      syncEarlyMirror();
      applyRootClasses();
      if (Folders) Folders.setEnabled(next.showFolders !== false);
      if (TokenTracker) TokenTracker.setEnabled(next.showTokenUsage !== false);
      refreshNow();
      if (fullChanged) {
        if (animOk()) {
          Navigator.startSmoothTrack(280);
          Collapse.startStickyTrack(280);
          startScrollBtnTrack(280);
          if (TokenTracker) TokenTracker.startSmoothTrack(280);
        }
        scheduleScrollBtnUpdate();
      } else if (widthChanged) {
        if (animOk()) {
          Navigator.startSmoothTrack(220);
          Collapse.startStickyTrack(220);
          startScrollBtnTrack(220);
          if (TokenTracker) TokenTracker.startSmoothTrack(220);
        }
        scheduleScrollBtnUpdate();
      }
    });
    if (window.chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(handleMessage);
    }
    watchNavigation();
    watchTheme();
  }

  boot().catch(function (err) {
    console.warn('[gopt] boot failed:', err);
  });
})();
