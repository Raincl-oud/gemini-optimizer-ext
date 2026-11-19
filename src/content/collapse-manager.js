/* Gemini Web Optimizer - collapse manager.
 * Pure core (computeTurnStates, computeRecollapseState, createCollapseState) + DOM adapter.
 * Hybrid 3-state portal keeps 54px Wrap pill below user-query and jitter-free at vertical screen center. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeminiOptCollapse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const OPEN_PAST_MIN = 0;
  const OPEN_PAST_MAX = 999;
  const DEFAULT_PAST = 4;

  // ---------- pure core ----------
  function parseOpenPast(v) {
    if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'object') return DEFAULT_PAST;
    if (typeof v === 'string' && v.trim() === '') return DEFAULT_PAST;
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_PAST;
    const c = Math.min(OPEN_PAST_MAX, Math.max(OPEN_PAST_MIN, Math.trunc(n)));
    return c === 0 ? 0 : c;
  }

  function computeTurnStates(input) {
    const turnIds = (input && input.turnIds) || [];
    const manual = (input && input.manualOpenIds) || new Set();
    const streamingId = input && input.streamingId !== undefined ? input.streamingId : null;
    const rawPast = input && (input.openPastChats !== undefined ? input.openPastChats : input.openLimit);
    const openPastChats = parseOpenPast(rawPast);
    const totalKeptOpen = 1 + openPastChats; // 1 latest/active chat + N Past Chats
    const total = turnIds.length;
    return turnIds.map(function (id, i) {
      if (!input || input.autoCollapse === false) return 'open';
      if (i >= total - totalKeptOpen) return 'open';
      if (streamingId !== null && id === streamingId) return 'open';
      return manual.has(id) ? 'manual-open' : 'collapsed';
    });
  }

  function computeRecollapseState(input) {
    const turnTop = Number(input && input.turnTop) || 0;
    const turnH = Math.max(0, Number(input && input.turnHeight) || 0);
    const turnBottom = input && input.turnBottom !== undefined ? Number(input.turnBottom) : (turnTop + turnH);
    const turnRight = Number(input && input.turnRight) || 0;
    const vw = Math.max(0, Number(input && input.viewportW) || 1200);
    const vh = Math.max(0, Number(input && input.viewportH) || 0);
    const btnH = Number(input && input.btnH) || 54;
    const pillW = Number(input && input.pillW) || 114;
    const pad = input && input.pad !== undefined ? Math.max(0, Number(input.pad) || 0) : 8;
    const rawMinTop = input && input.minTopOffset !== undefined ? Number(input.minTopOffset) : pad;
    const minTopOffset = Math.max(pad, Number.isFinite(rawMinTop) ? Math.round(rawMinTop) : pad);
    const maxOffset = Math.max(pad, Math.round(turnH - btnH - pad));
    const safeTopOffset = Math.min(minTopOffset, maxOffset);
    const effectiveTop = turnTop + safeTopOffset;
    const midTop = Math.round((vh - btnH) / 2);
    const left = Math.round(Math.min(vw - pillW - 8, Math.max(8, turnRight - pillW - pad)));

    if (turnBottom - effectiveTop <= btnH + pad || effectiveTop >= midTop) {
      return { mode: 'top', top: safeTopOffset, left: left };
    }
    if (turnBottom <= midTop + btnH + pad) {
      return { mode: 'bottom', top: maxOffset, left: left };
    }
    return { mode: 'middle', top: midTop, left: left };
  }

  function createCollapseState() {
    const manualOpen = new Set();
    return {
      manualOpen: manualOpen,
      expand: function (id) { manualOpen.add(id); },
      collapse: function (id) { manualOpen.delete(id); },
      expandAll: function (ids) { for (const id of ids) manualOpen.add(id); },
      collapseOld: function () { manualOpen.clear(); },
      reset: function () { manualOpen.clear(); },
      compute: function (input) {
        return computeTurnStates(Object.assign({}, input, { manualOpenIds: manualOpen }));
      }
    };
  }

  // ---------- DOM adapter ----------
  const state = createCollapseState();
  const counter = { value: 0 };
  const snippetCache = new WeakMap();
  const btnMap = new WeakMap();
  const btnToTurn = new WeakMap();
  const portaledBtns = new Set();
  const mediaDeferredTurns = new WeakSet();
  let last = null; // { els, ids, states, openPastChats, autoCollapse, streamingId }
  let bound = false;
  let resizeBound = false;
  let stickyScroller = null;
  let stickyRaf = 0;
  let stickyTrackRaf = 0;
  let stickyTrackUntil = 0;
  const listeners = new Set();

  function onStateChange(cb) {
    if (typeof cb !== 'function') return function () {};
    listeners.add(cb);
    return function () { listeners.delete(cb); };
  }

  function notify() {
    const els = last ? last.els.slice() : [];
    const states = last ? last.states.slice() : [];
    for (const cb of Array.from(listeners)) {
      try { cb(els, states); } catch (e) { if (root.console) root.console.warn('[gopt] state listener failed:', e); }
    }
  }

  function Sel() { return root.GeminiOptSelectors; }

  function svgIcon(d, cls, size) {
    const ns = 'http://www.w3.org/2000/svg';
    const sz = String(size || 14);
    const svg = root.document.createElementNS(ns, 'svg');
    if (cls) svg.setAttribute('class', cls);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', sz);
    svg.setAttribute('height', sz);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = root.document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
    return svg;
  }

  function span(cls, text) {
    const s = root.document.createElement('span');
    s.className = cls;
    if (text !== undefined) s.textContent = text;
    return s;
  }

  function ensureBar(el) {
    let bar = el.querySelector(':scope > .gopt-collapsed-bar');
    if (bar) return bar;
    bar = root.document.createElement('button');
    bar.type = 'button';
    bar.className = 'gopt-collapsed-bar';
    bar.setAttribute('data-gopt-owned', '');
    bar.setAttribute('aria-expanded', 'false');
    bar.appendChild(span('gopt-bar-index'));
    bar.appendChild(span('gopt-bar-snippet'));
    const action = span('gopt-bar-action');
    action.appendChild(root.document.createTextNode('Open'));
    action.appendChild(svgIcon('M6 9l6 6 6-6', '', 16));
    bar.appendChild(action);
    el.prepend(bar);
    return bar;
  }

  function ensureRecollapse(el, id) {
    let btn = btnMap.get(el) || el.querySelector(':scope > .gopt-recollapse-btn');
    if (!btn) {
      btn = root.document.createElement('button');
      btn.type = 'button';
      btn.className = 'gopt-recollapse-btn';
      btn.setAttribute('data-gopt-owned', '');
      const pill = span('gopt-recollapse-pill');
      pill.appendChild(svgIcon('M6 15l6-6 6 6', 'gopt-recollapse-icon', 22));
      pill.appendChild(span('gopt-recollapse-label', 'Wrap'));
      btn.appendChild(pill);
      el.prepend(btn);
    }
    btnMap.set(el, btn);
    btnToTurn.set(btn, el);
    setAttr(btn, 'data-gopt-for', id);
    return btn;
  }

  function parkBtnInTurn(btn, turnEl) {
    if (!btn) return;
    portaledBtns.delete(btn);
    btn.classList.remove('is-sticky-mid', 'is-sticky-bottom');
    btn.removeAttribute('data-mode');
    btn.style.left = '';
    btn.style.right = '';
    btn.style.top = '';
    btn.style.bottom = '';
    btn._goptMode = '';
    btn._goptLeft = null;
    btn._goptTop = null;
    if (turnEl && turnEl.isConnected) {
      if (btn.parentElement !== turnEl) turnEl.prepend(btn);
    } else {
      btn.remove();
    }
  }

  function setClass(el, cls, on) {
    if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
  }

  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  function updateStickyButtons() {
    stickyRaf = 0;
    if (!last || !root.document) return;
    const vw = root.innerWidth || 1200;
    const vh = root.innerHeight || 0;
    const toPark = [];
    const updates = [];

    // Pass 1: read all DOM rects before writing any styles or moving nodes.
    for (let i = 0; i < last.els.length; i++) {
      const el = last.els[i];
      const btn = btnMap.get(el);
      if (last.states[i] !== 'manual-open') {
        if (btn && portaledBtns.has(btn)) toPark.push([btn, el]);
        continue;
      }
      if (!btn) continue;
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;

      const uq = Sel().queryFirst(el, Sel().SEL.userQuery);
      let minTopOffset = 8;
      if (uq) {
        const uqr = uq.getBoundingClientRect();
        if (uqr.height > 0 && uqr.bottom > r.top) {
          minTopOffset = Math.max(8, Math.round(uqr.bottom - r.top + 8));
        }
      }
      const contentEl = Sel().queryFirst(el, ['model-response', 'user-query']) || el;
      const cr = contentEl.getBoundingClientRect();
      const turnRight = cr.width > 0 ? Math.min(vw, cr.right + 66) : r.right;
      const st = computeRecollapseState({
        turnTop: r.top, turnHeight: r.height, turnBottom: r.bottom, turnRight: turnRight,
        minTopOffset: minTopOffset, viewportW: vw, viewportH: vh, btnH: 54, pillW: 114, pad: 8
      });
      updates.push({ el: el, btn: btn, r: r, st: st });
    }

    // Pass 2: apply DOM mutations cleanly.
    for (const pair of toPark) parkBtnInTurn(pair[0], pair[1]);
    for (const item of updates) {
      const el = item.el, btn = item.btn, r = item.r, st = item.st;
      if (st.mode === 'middle') {
        if (btn.parentElement !== root.document.body) {
          root.document.body.appendChild(btn);
          portaledBtns.add(btn);
        }
        if (btn._goptMode !== 'middle') {
          btn._goptMode = 'middle';
          btn.setAttribute('data-mode', 'middle');
          btn.classList.add('is-sticky-mid');
          btn.classList.remove('is-sticky-bottom');
        }
        if (btn._goptTop !== null) {
          btn._goptTop = null;
          btn.style.top = '';
          btn.style.bottom = '';
        }
        if (btn._goptLeft !== st.left) {
          btn._goptLeft = st.left;
          btn.style.left = st.left + 'px';
          btn.style.right = 'auto';
        }
      } else {
        if (btn.parentElement !== el) {
          el.prepend(btn);
          portaledBtns.delete(btn);
        }
        if (btn._goptMode !== st.mode) {
          btn._goptMode = st.mode;
          btn.setAttribute('data-mode', st.mode);
          btn.classList.remove('is-sticky-mid');
          btn.classList.toggle('is-sticky-bottom', st.mode === 'bottom');
        }
        if (st.mode === 'top') {
          if (btn._goptTop !== st.top) {
            btn._goptTop = st.top;
            btn.style.top = st.top + 'px';
            btn.style.bottom = 'auto';
          }
        } else if (btn._goptTop !== 'bottom') {
          btn._goptTop = 'bottom';
          btn.style.top = 'auto';
          btn.style.bottom = '8px';
        }
        const relLeft = Math.round(st.left - r.left);
        if (btn._goptLeft !== relLeft) {
          btn._goptLeft = relLeft;
          btn.style.left = relLeft + 'px';
          btn.style.right = 'auto';
        }
      }
    }
  }

  function scheduleStickyUpdate() {
    if (stickyRaf || typeof root.requestAnimationFrame !== 'function') return;
    stickyRaf = root.requestAnimationFrame(updateStickyButtons);
  }

  function startStickyTrack(durationMs) {
    if (!last || typeof root.requestAnimationFrame !== 'function') return;
    const now = root.performance ? root.performance.now() : Date.now();
    const until = now + (durationMs || 280);
    if (until > stickyTrackUntil) stickyTrackUntil = until;
    if (stickyTrackRaf) return;
    const step = function () {
      stickyTrackRaf = 0;
      if (!last) return;
      updateStickyButtons();
      const t = root.performance ? root.performance.now() : Date.now();
      if (t < stickyTrackUntil) stickyTrackRaf = root.requestAnimationFrame(step);
    };
    stickyTrackRaf = root.requestAnimationFrame(step);
  }

  function ensureStickyListeners() {
    if (!root.document) return;
    const sc = Sel().findChatScroller(root.document);
    if (sc !== stickyScroller) {
      if (stickyScroller) stickyScroller.removeEventListener('scroll', scheduleStickyUpdate);
      stickyScroller = sc;
      if (stickyScroller) stickyScroller.addEventListener('scroll', scheduleStickyUpdate, { passive: true });
    }
    if (!resizeBound && root.addEventListener) {
      resizeBound = true;
      root.addEventListener('resize', scheduleStickyUpdate, { passive: true });
    }
  }

  function deferMediaInTurn(turnEl) {
    if (!turnEl || !turnEl.querySelectorAll || mediaDeferredTurns.has(turnEl)) return 0;
    mediaDeferredTurns.add(turnEl);
    let imgs;
    try { imgs = turnEl.querySelectorAll('img'); } catch (_) { return 0; }
    let updated = 0;
    for (const img of imgs) {
      let changed = false;
      if (!img.getAttribute || img.getAttribute('loading') !== 'lazy') {
        if (img.setAttribute) img.setAttribute('loading', 'lazy');
        changed = true;
      }
      if (!img.getAttribute || img.getAttribute('decoding') !== 'async') {
        if (img.setAttribute) img.setAttribute('decoding', 'async');
        changed = true;
      }
      if (changed) updated++;
    }
    return updated;
  }

  function applyOne(el, id, index, st, isStreaming) {
    setAttr(el, 'data-gopt-turn', id);
    setAttr(el, 'data-gopt-index', String(index + 1));
    setClass(el, 'gopt-turn-collapsed', st === 'collapsed');
    setClass(el, 'gopt-turn-manual-open', st === 'manual-open');
    setClass(el, 'gopt-turn-streaming', isStreaming);
    if (st === 'collapsed') {
      deferMediaInTurn(el);
      const existingBtn = btnMap.get(el);
      if (existingBtn) parkBtnInTurn(existingBtn, el);
      const bar = ensureBar(el);
      const n = index + 1;
      const uq = Sel().queryFirst(el, Sel().SEL.userQuery) || el;
      const rawLen = (uq.textContent || '').length;
      const cache = snippetCache.get(bar);
      if (!cache || cache.n !== n || cache.rawLen !== rawLen) {
        const snippet = Sel().getPromptText(el, 140);
        snippetCache.set(bar, { n: n, rawLen: rawLen, snippet: snippet });
        bar.querySelector('.gopt-bar-index').textContent = '#' + n;
        bar.querySelector('.gopt-bar-snippet').textContent = snippet;
        bar.setAttribute('aria-label', 'Open Past Chat #' + n + ': ' + snippet);
      }
    } else if (st === 'manual-open') {
      const btn = ensureRecollapse(el, id);
      setAttr(btn, 'aria-label', 'Wrap Past Chat #' + (index + 1));
    } else {
      const existingBtn = btnMap.get(el);
      if (existingBtn) parkBtnInTurn(existingBtn, el);
    }
  }

  function applyAll() {
    if (!last) return [];
    const streamingId = last.streamingId;
    last.states = state.compute({
      turnIds: last.ids, openPastChats: last.openPastChats, autoCollapse: last.autoCollapse, streamingId: streamingId
    });
    let hasManual = false;
    for (let i = 0; i < last.els.length; i++) {
      const st = last.states[i];
      if (st === 'manual-open') hasManual = true;
      applyOne(last.els[i], last.ids[i], i, st, streamingId !== null && last.ids[i] === streamingId);
    }
    if (hasManual) {
      ensureStickyListeners();
      scheduleStickyUpdate();
    }
    return last.states;
  }

  function sync(turnEls, settings, opts) {
    bindOnce();
    ensureStickyListeners();
    const els = Array.from(turnEls || []);
    if (last && last.els.length) {
      const nextSet = new Set(els);
      for (const oldEl of last.els) {
        if (!nextSet.has(oldEl)) {
          const b = btnMap.get(oldEl);
          if (b && portaledBtns.has(b)) parkBtnInTurn(b, oldEl.isConnected ? oldEl : null);
        }
      }
    }
    const ids = els.map(function (el) { return Sel().getTurnId(el, counter); });
    const si = opts && Number.isInteger(opts.streamingIndex) ? opts.streamingIndex : -1;
    last = {
      els: els, ids: ids, states: [],
      openPastChats: settings ? settings.openPastChats : undefined,
      autoCollapse: !settings || settings.autoCollapse !== false,
      streamingId: si >= 0 && si < ids.length ? ids[si] : null
    };
    return applyAll().slice();
  }

  function resolve(target) {
    if (!last) return null;
    if (typeof target === 'string') {
      const i = last.ids.indexOf(target);
      return i >= 0 ? last.els[i] : null;
    }
    return target || null;
  }

  function idOf(el) {
    if (!last) return null;
    const i = last.els.indexOf(el);
    return i >= 0 ? last.ids[i] : (el && el.getAttribute ? el.getAttribute('data-gopt-turn') : null);
  }

  function expandTurn(target) {
    const el = resolve(target);
    const id = el ? idOf(el) : null;
    if (!id) return null;
    state.expand(id);
    applyAll();
    return el;
  }

  function collapseTurn(target) {
    const el = resolve(target);
    const id = el ? idOf(el) : null;
    if (!id) return null;
    state.collapse(id);
    applyAll();
    return el;
  }

  function expandAll() {
    if (!last) return;
    const ids = last.ids.filter(function (_, i) { return last.states[i] === 'collapsed'; });
    state.expandAll(ids);
    applyAll();
  }

  function collapseOld() {
    state.collapseOld();
    applyAll();
  }

  function getStats() {
    const states = last ? last.states : [];
    const collapsed = states.filter(function (s) { return s === 'collapsed'; }).length;
    const manual = states.filter(function (s) { return s === 'manual-open'; }).length;
    return {
      total: states.length,
      collapsed: collapsed,
      open: states.length - collapsed,
      manualOpen: manual,
      streaming: !!(last && last.streamingId !== null)
    };
  }

  function getStates() {
    return last ? last.states.slice() : [];
  }

  function reset() {
    state.reset();
    for (const btn of Array.from(portaledBtns)) {
      parkBtnInTurn(btn, btnToTurn.get(btn));
    }
    portaledBtns.clear();
    last = null;
    if (stickyRaf && typeof root.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(stickyRaf);
      stickyRaf = 0;
    }
    if (stickyTrackRaf && typeof root.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(stickyTrackRaf);
      stickyTrackRaf = 0;
    }
    stickyTrackUntil = 0;
    if (stickyScroller) {
      stickyScroller.removeEventListener('scroll', scheduleStickyUpdate);
      stickyScroller = null;
    }
  }

  function onClick(ev) {
    const t = ev.target;
    if (!t || !t.closest) return;
    const btn = t.closest('.gopt-collapsed-bar, .gopt-recollapse-btn');
    if (!btn) return;
    let turn = btn.closest('[data-gopt-turn]');
    if (!turn && btn.classList.contains('gopt-recollapse-btn')) {
      turn = resolve(btn.getAttribute('data-gopt-for')) || btnToTurn.get(btn) || null;
    }
    if (!turn) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (btn.classList.contains('gopt-collapsed-bar')) {
      const scroller = Sel().findChatScroller(root.document);
      const before = turn.getBoundingClientRect().top;
      expandTurn(turn);
      if (scroller) {
        const after = turn.getBoundingClientRect().top;
        scroller.scrollTop += after - before;
      }
      scheduleStickyUpdate();
    } else {
      collapseTurn(turn);
      const bar = turn.querySelector(':scope > .gopt-collapsed-bar');
      if (bar && bar.scrollIntoView) bar.scrollIntoView({ block: 'nearest' });
    }
    notify();
  }

  function bindOnce() {
    if (bound || !root.document) return;
    bound = true;
    root.document.addEventListener('click', onClick, false);
  }

  return Object.freeze({
    computeTurnStates, computeRecollapseState, createCollapseState, deferMediaInTurn,
    sync, expandTurn, collapseTurn, expandAll, collapseOld, getStats, getStates, reset, onStateChange, startStickyTrack
  });
});
