/* Gemini Web Optimizer - left strip navigator.
 * Pure core: STRIP, computeStripTransforms, toTransformString, computeRailPlacement.
 * DOM adapter: rail + single tooltip portal in <body>. Hugs left edge of open text dynamically,
 * avoids ResizeObserver hot loops via target dedup, and displays turn status in tooltip. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeminiOptNavigator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STRIP = Object.freeze({
    ROW: 10, BASE_W: 14, BASE_H: 3, RADIUS: 2,
    SCALE_X: Object.freeze([1.9, 1.45, 1.18]),
    SCALE_Y: Object.freeze([1.67, 1.33, 1.0]),
    PUSH: Object.freeze([0, 3, 5, 6]),
    ACTIVE_SCALE_X: 1.45, COLLAPSED_OPACITY: 0.38, IDLE_OPACITY: 0.55, ACTIVE_OPACITY: 1, HOVER_OPACITY: 1
  });
  const LIST_PAD = 8;
  const TRACK_PROPS = new Set(['width', 'margin-left', 'margin-right', 'padding-left', 'transform', 'flex-basis', 'left', 'grid-template-columns', '']);

  function sameElements(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ---------- pure core ----------
  function computeStripTransforms(input) {
    const count = Math.max(0, (input && input.count) | 0);
    const h = input && Number.isInteger(input.hoverIndex) ? input.hoverIndex : -1;
    const a = input && Number.isInteger(input.activeIndex) ? input.activeIndex : -1;
    const collapsed = (input && input.collapsed) || [];
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      const isActive = i === a;
      const isCollapsed = !!collapsed[i];
      const baseOpacity = isActive ? STRIP.ACTIVE_OPACITY : (isCollapsed ? STRIP.COLLAPSED_OPACITY : STRIP.IDLE_OPACITY);
      const activeX = isActive ? STRIP.ACTIVE_SCALE_X : 1;
      if (h < 0 || h >= count) {
        out[i] = { scaleX: activeX, scaleY: 1, translateY: 0, opacity: baseOpacity };
        continue;
      }
      const d = Math.abs(i - h);
      const sx = STRIP.SCALE_X[d] !== undefined ? STRIP.SCALE_X[d] : 1;
      const sy = STRIP.SCALE_Y[d] !== undefined ? STRIP.SCALE_Y[d] : 1;
      const ty = Math.sign(i - h) * STRIP.PUSH[Math.min(d, 3)];
      out[i] = {
        scaleX: Math.max(sx, activeX),
        scaleY: sy,
        translateY: ty === 0 ? 0 : ty,
        opacity: d <= STRIP.RADIUS ? STRIP.HOVER_OPACITY : baseOpacity
      };
    }
    return out;
  }

  function toTransformString(t) {
    return 'translate3d(0, ' + t.translateY + 'px, 0) scale(' + t.scaleX + ', ' + t.scaleY + ')';
  }

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), Math.max(lo, hi)); }

  function computeRailPlacement(input) {
    const a = input.anchorRect;
    const row = input.row || STRIP.ROW;
    const inset = input.inset !== undefined ? input.inset : 10;
    const minLeft = input.minLeft !== undefined ? input.minLeft : 8;
    const vw = input.viewportW;
    const vh = input.viewportH;
    const left = input.textLeft !== undefined
      ? clamp(Math.round(input.textLeft - 34), minLeft, vw - 24)
      : clamp(Math.round(a.left + inset), minLeft, vw - 24);
    const listH = Math.max(0, Math.min(input.count * row + 16, a.height - 48, vh - 96));
    const midTop = Math.round((vh - listH) / 2);

    if (Number.isFinite(input.textTop) && Number.isFinite(input.textBottom)) {
      const minTop = Math.round(input.textTop + 8);
      const maxTop = Math.round(input.textBottom - listH - 8);
      if (maxTop <= minTop || midTop <= minTop) {
        return { left: left, top: minTop, height: listH, mode: 'top' };
      }
      if (midTop >= maxTop) {
        return { left: left, top: maxTop, height: listH, mode: 'bottom' };
      }
      return { left: left, top: midTop, height: listH, mode: 'middle' };
    }
    const top = Math.round(a.top + (a.height - listH) / 2);
    return { left: left, top: top, height: listH, mode: 'middle' };
  }

  // ---------- DOM adapter ----------
  const S = {
    doc: null, rail: null, list: null, tip: null, tipIdx: null, tipStatus: null, tipText: null,
    strips: [], collapsed: [], turnEls: [], turnIndex: new Map(),
    hover: -1, active: -1, onNav: null,
    io: null, ioRoot: null, scrollEl: null, ro: null, roTargets: [], intersecting: new Set(),
    placeRaf: 0, trackRaf: 0, trackUntil: 0, moveRaf: 0, tipTimer: 0,
    cachedTextLeft: null, textLeftDirty: true, scrollOnlyPlace: true,
    tipVisible: false, mounted: false, lastPlace: ''
  };

  function Sel() { return root.GeminiOptSelectors; }
  function prefersReduced() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function animOk() {
    return !prefersReduced();
  }
  function hoverFine() {
    return !!(root.matchMedia && root.matchMedia('(hover: hover) and (pointer: fine)').matches);
  }
  function waveOk() {
    return !prefersReduced() && hoverFine();
  }

  function measureContentLeft(turnEl) {
    if (!turnEl) return null;
    const isCollapsed = turnEl.classList && turnEl.classList.contains('gopt-turn-collapsed');
    if (isCollapsed) {
      const bar = turnEl.querySelector(':scope > .gopt-collapsed-bar');
      if (bar) {
        const br = bar.getBoundingClientRect();
        if (br.width > 0) return br.left;
      }
    }
    const inner = turnEl.querySelector('user-query, model-response, .markdown');
    if (inner) {
      const ir = inner.getBoundingClientRect();
      if (ir.width > 0) return ir.left;
    }
    if (!isCollapsed) {
      const bar = turnEl.querySelector(':scope > .gopt-collapsed-bar');
      if (bar) {
        const br = bar.getBoundingClientRect();
        if (br.width > 0) return br.left;
      }
    }
    const tr = turnEl.getBoundingClientRect();
    return tr.width > 0 ? tr.left : null;
  }

  function place(fromScrollArg) {
    S.placeRaf = 0;
    const fromScroll = arguments.length > 0 ? fromScrollArg === true : S.scrollOnlyPlace;
    S.scrollOnlyPlace = true;
    if (!S.rail) return;
    const d = S.doc;
    const vw = root.innerWidth, vh = root.innerHeight;
    const anchorEl = Sel().findChatScroller(d) || Sel().findMainArea(d);
    let r = anchorEl ? anchorEl.getBoundingClientRect() : null;
    if (!r || r.width === 0 || r.height === 0) r = { left: 0, top: 0, width: vw, height: vh };

    let textLeft;
    let textTop;
    let textBottom;
    if (S.turnEls.length > 0) {
      let firstOpenIdx = -1;
      let lastOpenIdx = -1;
      for (let i = 0; i < S.turnEls.length; i++) {
        if (!S.collapsed[i]) {
          if (firstOpenIdx < 0) firstOpenIdx = i;
          lastOpenIdx = i;
        }
      }
      if (firstOpenIdx < 0) {
        firstOpenIdx = 0;
        lastOpenIdx = S.turnEls.length - 1;
      }
      if (fromScroll && !S.textLeftDirty && S.cachedTextLeft !== null) {
        textLeft = S.cachedTextLeft;
      } else {
        for (let i = firstOpenIdx; i <= lastOpenIdx; i++) {
          if (!S.collapsed[i]) {
            const l = measureContentLeft(S.turnEls[i]);
            if (l !== null) { textLeft = l; break; }
          }
        }
        if (textLeft === undefined) {
          for (let i = 0; i < S.turnEls.length; i++) {
            const l = measureContentLeft(S.turnEls[i]);
            if (l !== null) { textLeft = l; break; }
          }
        }
        S.cachedTextLeft = textLeft !== undefined ? textLeft : null;
        S.textLeftDirty = false;
      }
      const firstR = S.turnEls[firstOpenIdx].getBoundingClientRect();
      const lastR = S.turnEls[lastOpenIdx].getBoundingClientRect();
      if (firstR.height > 0 || lastR.height > 0) {
        textTop = firstR.top;
        textBottom = lastR.bottom;
      }
    }

    const p = computeRailPlacement({
      anchorRect: r, viewportW: vw, viewportH: vh, count: S.strips.length,
      textLeft: textLeft, textTop: textTop, textBottom: textBottom
    });
    const key = [p.left, p.top, p.height].join('|');
    if (key === S.lastPlace) return;
    S.lastPlace = key;
    S.rail.style.left = p.left + 'px';
    S.rail.style.top = p.top + 'px';
    S.rail.style.height = p.height + 'px';
  }

  function schedulePlace(fromScroll) {
    if (fromScroll !== true) S.scrollOnlyPlace = false;
    if (S.placeRaf) return;
    S.placeRaf = root.requestAnimationFrame(function () { place(); });
  }

  function onScrollPlace() { schedulePlace(true); }
  function onResizePlace() { S.textLeftDirty = true; schedulePlace(false); }

  function cancelTrack() {
    if (S.trackRaf) { root.cancelAnimationFrame(S.trackRaf); S.trackRaf = 0; }
    S.trackUntil = 0;
  }

  function startSmoothTrack(durationMs) {
    S.textLeftDirty = true;
    if (!S.mounted || typeof root.requestAnimationFrame !== 'function') return;
    const now = root.performance ? root.performance.now() : Date.now();
    const until = now + (durationMs || 360);
    if (until > S.trackUntil) S.trackUntil = until;
    if (S.trackRaf) return;
    const step = function () {
      S.trackRaf = 0;
      if (!S.mounted) return;
      S.textLeftDirty = true;
      place(false);
      const t = root.performance ? root.performance.now() : Date.now();
      if (t < S.trackUntil) S.trackRaf = root.requestAnimationFrame(step);
    };
    S.trackRaf = root.requestAnimationFrame(step);
  }

  function onDocTransition(ev) {
    const target = ev && ev.target;
    if (!target || target.nodeType !== 1) return;
    if (target.hasAttribute('data-gopt-owned')) return;
    if (ev.propertyName && !TRACK_PROPS.has(ev.propertyName)) return;
    const s = Sel();
    const scroller = s.findChatScroller(S.doc);
    const main = s.queryFirst(S.doc, s.SEL.mainArea);
    const sidenav = s.queryFirst(S.doc, s.SEL.sidenav);
    const isAnchor = function (a) { return !!(a && (a === target || target.contains(a))); };
    const inSidenav = !!(sidenav && (sidenav === target || target.contains(sidenav) || sidenav.contains(target)));
    if (isAnchor(scroller) || isAnchor(main) || inSidenav) {
      S.textLeftDirty = true;
      startSmoothTrack(360);
    }
  }

  function applyTransforms() {
    const ts = computeStripTransforms({
      count: S.strips.length,
      hoverIndex: waveOk() ? S.hover : -1,
      activeIndex: S.active,
      collapsed: S.collapsed
    });
    for (let i = 0; i < ts.length; i++) {
      const bar = S.strips[i].bar;
      const t = ts[i];
      const key = toTransformString(t) + '|' + t.opacity;
      if (S.strips[i].key === key) continue;
      S.strips[i].key = key;
      bar.style.transform = toTransformString(t);
      bar.style.opacity = String(t.opacity);
    }
  }

  function createStrip(i) {
    const btn = S.doc.createElement('button');
    btn.type = 'button';
    btn.className = 'gopt-strip';
    btn.setAttribute('data-gopt-owned', '');
    btn.setAttribute('data-gopt-strip', String(i));
    const bar = S.doc.createElement('span');
    bar.className = 'gopt-strip-bar';
    btn.appendChild(bar);
    S.list.appendChild(btn);
    return { el: btn, bar: bar, key: '', label: '', turnId: '' };
  }

  function stripIndexFromEvent(ev) {
    const t = ev.target;
    const s = t && t.closest ? t.closest('.gopt-strip') : null;
    if (!s) return -1;
    const n = Number(s.getAttribute('data-gopt-strip'));
    return Number.isInteger(n) ? n : -1;
  }

  function indexFromPointer(ev) {
    const rect = S.list.getBoundingClientRect();
    const y = ev.clientY - rect.top + S.list.scrollTop - LIST_PAD;
    const i = Math.floor(y / STRIP.ROW);
    return i >= 0 && i < S.strips.length ? i : -1;
  }

  function showTip(i) {
    const strip = S.strips[i];
    const turnEl = S.turnEls[i];
    if (!strip || !turnEl) return hideTip();
    S.tipIdx.textContent = '#' + (i + 1);
    const isCol = !!S.collapsed[i];
    S.tipStatus.textContent = isCol ? 'Wrapped' : 'Open';
    S.tipStatus.classList.toggle('is-collapsed', isCol);
    S.tipText.textContent = Sel().getPromptText(turnEl, 220);
    const r = strip.el.getBoundingClientRect();
    const tw = S.tip.offsetWidth, th = S.tip.offsetHeight;
    const left = clamp(r.right + 10, 4, root.innerWidth - tw - 4);
    const top = clamp(r.top + r.height / 2 - th / 2, 4, root.innerHeight - th - 4);
    S.tip.style.left = left + 'px';
    S.tip.style.top = top + 'px';
    if (S.tipVisible) return;
    root.clearTimeout(S.tipTimer);
    S.tipTimer = root.setTimeout(function () {
      S.tip.classList.add('is-visible');
      S.tipVisible = true;
    }, 80);
  }

  function hideTip() {
    root.clearTimeout(S.tipTimer);
    if (S.tip) S.tip.classList.remove('is-visible');
    S.tipVisible = false;
  }

  function setHover(i, fromFocus) {
    if (i === S.hover) return;
    S.hover = i;
    applyTransforms();
    if (i >= 0) {
      showTip(i);
      if (fromFocus && S.strips[i]) S.strips[i].el.setAttribute('aria-describedby', 'gopt-tooltip');
    } else hideTip();
  }

  function cancelMove() {
    if (S.moveRaf) { root.cancelAnimationFrame(S.moveRaf); S.moveRaf = 0; }
  }

  function onPointerMove(ev) {
    if (ev.pointerType === 'touch' || !hoverFine()) return;
    if (S.moveRaf) return;
    const fake = { clientY: ev.clientY };
    S.moveRaf = root.requestAnimationFrame(function () {
      S.moveRaf = 0;
      if (!S.mounted) return;
      setHover(indexFromPointer(fake), false);
    });
  }

  function onClick(ev) {
    const i = stripIndexFromEvent(ev);
    if (i < 0 || !S.onNav || !S.turnEls[i]) return;
    S.onNav(S.turnEls[i]);
  }

  function mount(doc) {
    if (S.mounted) return;
    const d = doc || root.document;
    S.doc = d;
    S.rail = d.createElement('div');
    S.rail.className = 'gopt-rail';
    S.rail.setAttribute('data-gopt-owned', '');
    S.list = d.createElement('div');
    S.list.className = 'gopt-rail-list';
    S.list.setAttribute('data-gopt-owned', '');
    S.rail.appendChild(S.list);

    S.tip = d.createElement('div');
    S.tip.className = 'gopt-tooltip';
    S.tip.id = 'gopt-tooltip';
    S.tip.setAttribute('role', 'tooltip');
    S.tip.setAttribute('data-gopt-owned', '');
    const tipHead = d.createElement('div');
    tipHead.className = 'gopt-tooltip-head';
    S.tipIdx = d.createElement('span');
    S.tipIdx.className = 'gopt-tooltip-index';
    S.tipStatus = d.createElement('span');
    S.tipStatus.className = 'gopt-tooltip-status';
    tipHead.appendChild(S.tipIdx);
    tipHead.appendChild(S.tipStatus);
    S.tipText = d.createElement('p');
    S.tipText.className = 'gopt-tooltip-text';
    S.tip.appendChild(tipHead);
    S.tip.appendChild(S.tipText);

    d.body.appendChild(S.rail);
    d.body.appendChild(S.tip);

    S.list.addEventListener('pointermove', onPointerMove, { passive: true });
    S.list.addEventListener('pointerleave', function () { cancelMove(); setHover(-1, false); });
    S.list.addEventListener('click', onClick);
    S.list.addEventListener('focusin', function (ev) { const i = stripIndexFromEvent(ev); if (i >= 0) setHover(i, true); });
    S.list.addEventListener('focusout', function (ev) {
      const t = ev.target;
      if (t && t.removeAttribute && t.classList && t.classList.contains('gopt-strip')) t.removeAttribute('aria-describedby');
      setHover(-1, false);
    });
    d.addEventListener('transitionstart', onDocTransition, { capture: true, passive: true });
    d.addEventListener('transitionrun', onDocTransition, { capture: true, passive: true });
    root.addEventListener('resize', onResizePlace, { passive: true });

    if (typeof root.ResizeObserver === 'function') {
      S.ro = new root.ResizeObserver(function () { S.textLeftDirty = true; startSmoothTrack(360); });
      observeAnchors();
    }
    S.mounted = true;
    S.textLeftDirty = true;
    schedulePlace(false);
  }

  function observeAnchors() {
    if (!S.ro) return;
    const s = Sel();
    const next = [s.findChatScroller(S.doc), s.queryFirst(S.doc, s.SEL.mainArea), s.queryFirst(S.doc, s.SEL.sidenav)].filter(Boolean);
    if (sameElements(S.roTargets, next)) return;
    S.ro.disconnect();
    S.roTargets = next;
    for (const el of next) S.ro.observe(el);
  }

  function ensureSpy() {
    const scroller = Sel().findChatScroller(S.doc);
    if (scroller !== S.scrollEl) {
      if (S.scrollEl) S.scrollEl.removeEventListener('scroll', onScrollPlace);
      S.scrollEl = scroller;
      if (S.scrollEl) S.scrollEl.addEventListener('scroll', onScrollPlace, { passive: true });
    }
    if (typeof root.IntersectionObserver !== 'function') return;
    if (S.io && S.ioRoot === scroller) return;
    if (S.io) {
      S.io.disconnect();
      S.intersecting.clear();
      S.turnIndex = new Map();
    }
    S.ioRoot = scroller;
    S.io = new root.IntersectionObserver(function (entries) {
      for (const e of entries) {
        if (e.isIntersecting) S.intersecting.add(e.target); else S.intersecting.delete(e.target);
      }
      let best = -1;
      for (const el of S.intersecting) {
        const i = S.turnIndex.get(el);
        if (i !== undefined && i > best) best = i;
      }
      if (best >= 0) setActive(best);
    }, { root: scroller, rootMargin: '-30% 0px -60% 0px', threshold: 0 });
  }

  function update(turnEls, states) {
    if (!S.mounted) mount(root.document);
    const els = Array.from(turnEls || []);
    const n = els.length;
    while (S.strips.length < n) S.strips.push(createStrip(S.strips.length));
    while (S.strips.length > n) S.strips.pop().el.remove();

    ensureSpy();
    const prevIndex = S.turnIndex;
    const nextIndex = new Map();
    els.forEach(function (el, i) { nextIndex.set(el, i); });
    if (S.io) {
      for (const old of prevIndex.keys()) {
        if (!nextIndex.has(old)) { S.io.unobserve(old); S.intersecting.delete(old); }
      }
      for (const el of els) if (!prevIndex.has(el)) S.io.observe(el);
    }
    S.turnIndex = nextIndex;
    S.turnEls = els;
    S.collapsed = new Array(n);
    for (let i = 0; i < n; i++) {
      const strip = S.strips[i];
      const isCollapsed = !!states && states[i] === 'collapsed';
      S.collapsed[i] = isCollapsed;
      if (strip.el.classList.contains('is-collapsed') !== isCollapsed) strip.el.classList.toggle('is-collapsed', isCollapsed);
      const label = 'Jump to Past Chat #' + (i + 1) + (isCollapsed ? ' (wrapped)' : '');
      if (strip.label !== label) { strip.label = label; strip.el.setAttribute('aria-label', label); }
    }
    S.rail.classList.toggle('has-turns', n > 0);
    if (S.active >= n) S.active = -1;
    if (S.hover >= n) setHover(-1, false);
    applyTransforms();
    observeAnchors();
    S.textLeftDirty = true;
    schedulePlace(false);
  }

  function setActive(index) {
    if (index === S.active) return;
    if (S.strips[S.active]) S.strips[S.active].el.classList.remove('is-active');
    S.active = index;
    const strip = S.strips[index];
    if (strip) {
      strip.el.classList.add('is-active');
      strip.el.setAttribute('aria-current', 'true');
      centerActive(strip);
    }
    for (let i = 0; i < S.strips.length; i++) if (i !== index) S.strips[i].el.removeAttribute('aria-current');
    applyTransforms();
  }

  function centerActive(strip) {
    const list = S.list;
    const h = list.clientHeight;
    const top = strip.el.offsetTop - list.scrollTop;
    if (top > h * 0.2 && top < h * 0.8) return;
    list.scrollTo({ top: strip.el.offsetTop - h / 2 + STRIP.ROW / 2, behavior: animOk() ? 'smooth' : 'auto' });
  }

  function reset() {
    if (!S.mounted) return;
    if (S.io) { S.io.disconnect(); S.io = null; S.ioRoot = null; }
    if (S.ro) S.ro.disconnect();
    S.roTargets = [];
    if (S.scrollEl) { S.scrollEl.removeEventListener('scroll', onScrollPlace); S.scrollEl = null; }
    S.intersecting.clear();
    S.turnIndex = new Map();
    S.turnEls = [];
    S.collapsed = [];
    while (S.strips.length) S.strips.pop().el.remove();
    cancelTrack();
    cancelMove();
    S.hover = -1;
    S.active = -1;
    hideTip();
    S.rail.classList.remove('has-turns');
    S.lastPlace = '';
    S.cachedTextLeft = null;
    S.textLeftDirty = true;
    S.scrollOnlyPlace = true;
  }

  function destroy() {
    if (!S.mounted) return;
    reset();
    if (S.placeRaf) { root.cancelAnimationFrame(S.placeRaf); S.placeRaf = 0; }
    if (S.ro) { S.ro.disconnect(); S.ro = null; }
    S.roTargets = [];
    if (S.doc) {
      S.doc.removeEventListener('transitionstart', onDocTransition, { capture: true });
      S.doc.removeEventListener('transitionrun', onDocTransition, { capture: true });
    }
    root.removeEventListener('resize', onResizePlace);
    S.rail.remove();
    S.tip.remove();
    S.rail = S.list = S.tip = S.tipIdx = S.tipStatus = S.tipText = null;
    S.mounted = false;
  }

  function onNavigate(cb) { S.onNav = typeof cb === 'function' ? cb : null; }

  return Object.freeze({
    STRIP, computeStripTransforms, toTransformString, computeRailPlacement,
    mount, update, setActive, reset, destroy, onNavigate, startSmoothTrack
  });
});
