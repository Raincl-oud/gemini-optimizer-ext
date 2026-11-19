/* Gemini Web Optimizer - the single seam to Gemini's DOM.
 * Every Gemini tag/class/aria string lives in SEL. A UI change upstream is a one-line fix here.
 * SEL.sourcesStatic and SEL.nativeScrollDown are mirrored in src/content/ui-overlay.css. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeminiOptSelectors = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SEL = Object.freeze({
    chatScroller: ['infinite-scroller.chat-history', '#chat-history', '[data-test-id="chat-history-container"]',
      'main .chat-history', 'main [role="log"]'],
    turn: ['.conversation-container', '[data-test-id="conversation-turn"]',
      'div:has(> user-query):has(> model-response)'],
    userQuery: ['user-query'],
    userText: ['.query-text', '.query-text-line', '[data-test-id="user-query-text"]', 'user-query-content'],
    modelResponse: ['model-response'],
    streamingHint: ['model-response [aria-busy="true"]', 'model-response .is-loading', 'pending-request',
      'model-response:not(:has(message-actions))'],
    stopButton: ['button[aria-label*="Stop" i]', 'button[aria-label*="Hentikan" i]', 'button.stop'],
    mainArea: ['main', 'chat-window', '.chat-container'],
    sidenav: ['bard-sidenav', 'side-navigation-v2', 'mat-sidenav', 'nav[role="navigation"]'],
    composerAnchor: ['input-area-v2', '.input-area-container', '.bottom-container', 'main form', 'rich-textarea'],
    composerInput: ['rich-textarea [contenteditable="true"]', '.text-input-field [contenteditable="true"]',
      'rich-textarea textarea', '.ql-editor[contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]'],
    disclaimer: ['hallucination-disclaimer', '.hallucination-disclaimer', '[data-test-id="disclaimer"]',
      'footer .disclaimer', '.bottom-container .disclaimer-container', '.disclaimer-container', '.disclaimer-text'],
    planBadge: ['[data-test-id*="pillbox" i]', '[data-test-id*="subscription" i]', '[data-test-id*="tier" i]',
      'header [aria-label*="Gemini Advanced" i]', 'header [aria-label*="AI Ultra" i]',
      'header [aria-label*="AI Pro" i]', 'header [aria-label*="AI Plus" i]',
      '.bard-logo-container', 'a[href*="one.google.com"]', 'button[aria-label*="Upgrade" i]',
      'button[aria-label*="Tingkatkan" i]'],
    modelSelector: ['[data-test-id="bard-mode-menu-button"]', 'bard-mode-switcher button',
      '[data-test-id*="model-selector" i]', 'input-area-v2 button[aria-haspopup="menu"]',
      '.input-area-container button[aria-haspopup="menu"]'],
    limitBanner: ['[data-test-id*="quota" i]', '[data-test-id*="limit" i]', 'snack-bar-container', '[role="alert"]'],
    nativeScrollDown: ['button.scroll-to-bottom-button', 'button[aria-label*="scroll to bottom" i]',
      'button[aria-label*="ke bawah" i]:not(.gopt-scroll-bottom-btn)', '[data-test-id="scroll-to-bottom"]'],
    a11yHidden: ['.cdk-visually-hidden', '[aria-hidden="true"]', '.sr-only', '.visually-hidden'],

    // Sources: static, CSS-hidden under html.gopt-hide-sources.
    sourcesStatic: ['sources-carousel-inline', 'sources-carousel', 'source-footnote', 'sources-list',
      'inline-source-chip', '.source-inline-chip', '.citation-chip', 'sup.superscript[data-turn-source-index]',
      'button[data-test-id="sources-button"]', '[data-test-id="sources-panel"]',
      'context-attribution', 'response-attribution'],

    // Protected: never hidden, never tagged, even if they match something above.
    protected: ['model-thoughts', '.thoughts-container', '[data-test-id*="thought" i]',
      'immersive-entry-chip', 'tool-response', 'extension-response', '[data-test-id*="drive" i] .card',
      'gmail-card', 'drive-card', '[class*="attachment"]', 'code-block', 'pre', 'table',
      'user-query']
  });

  const PROSE_SEL = '.markdown p, .markdown li, .markdown td, .markdown h1, .markdown h2, .markdown h3, .markdown blockquote';
  const ATTRIBUTION_RE = /^(menggunakan info dari|using info(rmation)? from|berdasarkan (memori|percakapan)|based on (your )?(memory|saved info|past chats)|sumber|sources)\b/i;
  const APP_BADGE_RE = /^@(drive|gmail|google drive|docs)\b/i;
  const CITATION_TEXT_RE = /^\[?\d{1,3}\]?$/;
  const CITATION_ATTR_RE = /citation|source|footnote/i;
  const SAID_PREFIX_RE = /^(you said|anda berkata)\s*:?\s*/i;
  const EMPTY_PROMPT = '(Empty prompt)';
  const A11Y_JOINED = SEL.a11yHidden.join(',');
  const STRIP_OWNED_SEL = ['[data-gopt-owned]', '[class*="gopt-"]', 'style', 'script'].concat(SEL.a11yHidden).join(',');

  function queryAll(rootEl, list) {
    const out = [];
    if (!rootEl || !rootEl.querySelectorAll) return out;
    const seen = new Set();
    for (const s of list) {
      let found;
      try { found = rootEl.querySelectorAll(s); } catch (_) { continue; }
      for (const el of found) if (!seen.has(el)) { seen.add(el); out.push(el); }
    }
    return out;
  }

  function queryFirst(rootEl, list) {
    if (!rootEl || !rootEl.querySelector) return null;
    for (const s of list) {
      try {
        const el = rootEl.querySelector(s);
        if (el) return el;
      } catch (_) { /* invalid/unsupported selector: skip */ }
    }
    return null;
  }

  function findChatScroller(doc) {
    const d = doc || root.document;
    return d ? queryFirst(d, SEL.chatScroller) : null;
  }

  function findMainArea(doc) {
    const d = doc || root.document;
    if (!d) return null;
    return findChatScroller(d) || queryFirst(d, SEL.mainArea);
  }

  const DISCLAIMER_RE = /(gemini.*(mistake|kesalahan|double-check|periksa kembali|inaccurate|tidak akurat))/i;

  function findComposerAnchor(doc) {
    const d = doc || root.document;
    return d ? queryFirst(d, SEL.composerAnchor) : null;
  }

  function findComposerInput(doc) {
    const d = doc || root.document;
    return d ? queryFirst(d, SEL.composerInput) : null;
  }

  function findDisclaimer(doc) {
    const d = doc || root.document;
    if (!d) return null;
    const directAll = queryAll(d, SEL.disclaimer);
    for (const el of directAll) {
      if (el.closest && el.closest('infinite-scroller, .chat-history, model-response, user-query, [data-gopt-owned]')) continue;
      if (el.setAttribute) el.setAttribute('data-gopt-disclaimer', '1');
      return el;
    }
    const scope = queryFirst(d, ['input-container', '.bottom-container', 'chat-window', 'bard-sidenav-content', 'main']) || d.body;
    if (!scope || !scope.querySelectorAll) return null;
    let nodes;
    try { nodes = scope.querySelectorAll('div, span, p, small'); } catch (_) { return null; }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const el = nodes[i];
      if (el.closest && el.closest('infinite-scroller, .chat-history, model-response, user-query, rich-textarea, [data-gopt-owned], button, [role="button"], [contenteditable="true"]')) continue;
      if (el.querySelector && el.querySelector('rich-textarea, textarea, input, button, [contenteditable="true"]')) continue;
      const txt = (el.textContent || '').trim();
      if (txt && txt.length <= 220 && DISCLAIMER_RE.test(txt)) {
        if (el.setAttribute) el.setAttribute('data-gopt-disclaimer', '1');
        return el;
      }
    }
    return null;
  }

  function getTurns(rootEl) {
    if (!rootEl || !rootEl.querySelectorAll) return [];
    let list = [];
    for (const s of SEL.turn) {
      let found;
      try { found = Array.from(rootEl.querySelectorAll(s)); } catch (_) { continue; }
      if (found.length) { list = found; break; }
    }
    if (list.length < 2) return list;
    const set = new Set(list);
    return list.filter(function (el) {
      for (let p = el.parentElement; p && p !== rootEl; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }

  function getTurnId(turnEl, counterRef) {
    if (turnEl.id) return turnEl.id;
    const existing = turnEl.getAttribute && turnEl.getAttribute('data-gopt-turn');
    if (existing) return existing;
    const ref = counterRef || { value: 0 };
    ref.value = (ref.value || 0) + 1;
    return 'gopt-' + ref.value;
  }

  function cleanText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function isA11yHidden(el) {
    if (!el) return false;
    try {
      if (el.matches && el.matches(A11Y_JOINED)) return true;
      if (el.closest && el.closest(A11Y_JOINED)) return true;
    } catch (_) { /* ignore */ }
    return false;
  }

  function ownTextOf(el) {
    if (!el) return '';
    if (typeof el.cloneNode !== 'function') return el.textContent || '';
    const clone = el.cloneNode(true);
    if (clone && clone.querySelectorAll) {
      try {
        for (const n of clone.querySelectorAll(STRIP_OWNED_SEL)) {
          if (n && typeof n.remove === 'function') n.remove();
        }
      } catch (_) { /* ignore */ }
    }
    return (clone && clone.textContent) || '';
  }

  function dedupeHalf(s) {
    if (s.length < 4) return s;
    const w = s.split(/\s+/);
    if (w.length >= 2 && w.length % 2 === 0) {
      const half = w.length / 2;
      const first = w.slice(0, half).join(' ');
      if (first === w.slice(half).join(' ')) return first;
    }
    const m = /^(.{2,})\s+\1$/s.exec(s);
    return m ? m[1] : s;
  }

  function dedupePromptText(raw) {
    let txt = cleanText(raw);
    txt = dedupeHalf(txt);
    txt = cleanText(txt.replace(SAID_PREFIX_RE, ''));
    txt = dedupeHalf(txt);
    return txt;
  }

  function getPromptText(turnEl, maxLen) {
    const max = maxLen > 0 ? maxLen : 280;
    if (!turnEl) return EMPTY_PROMPT;
    const q = queryFirst(turnEl, SEL.userQuery) || turnEl;
    let raw = '';
    if (q.querySelectorAll) {
      let lines = [];
      try { lines = Array.from(q.querySelectorAll('.query-text-line')); } catch (_) { lines = []; }
      if (lines.length) {
        const parts = [];
        for (const line of lines) {
          if (isA11yHidden(line)) continue;
          const t = cleanText(ownTextOf(line));
          if (t && parts[parts.length - 1] !== t) parts.push(t);
        }
        raw = parts.join(' ');
      }
    }
    if (!raw) {
      const node = queryFirst(q, SEL.userText) || q;
      raw = ownTextOf(node);
    }
    const txt = dedupePromptText(raw);
    if (!txt) return EMPTY_PROMPT;
    return txt.length > max ? txt.slice(0, max - 1).trimEnd() + '\u2026' : txt;
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.getClientRects) return el.getClientRects().length > 0;
    return true;
  }

  function isTurnStreaming(turnEl, isLast, doc) {
    if (!isLast || !turnEl) return false;
    const d = doc || root.document;
    const stop = d ? queryAll(d, SEL.stopButton).some(isVisible) : false;
    if (stop) return true;
    return queryFirst(turnEl, SEL.streamingHint) !== null;
  }

  function luminance(rgb) {
    const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(rgb || '');
    if (!m) return null;
    if (m[4] !== undefined && Number(m[4]) === 0) return null;
    const ch = [m[1], m[2], m[3]].map(function (v) {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function detectTheme(doc) {
    const d = doc || root.document;
    if (!d) return 'light';
    const html = d.documentElement;
    const body = d.body;
    const cl = function (el, c) { return !!(el && el.classList && el.classList.contains(c)); };
    if (cl(body, 'dark-theme') || cl(html, 'dark-theme') || cl(body, 'dark')) return 'dark';
    if (html && html.hasAttribute && html.hasAttribute('dark')) return 'dark';
    if ((html && html.getAttribute && html.getAttribute('data-theme') === 'dark') ||
        (body && body.getAttribute && body.getAttribute('data-theme') === 'dark')) return 'dark';
    try {
      const view = d.defaultView || root;
      if (body && view.getComputedStyle) {
        const lum = luminance(view.getComputedStyle(body).backgroundColor);
        if (lum !== null) return lum < 0.4 ? 'dark' : 'light';
      }
      if (view.matchMedia && view.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch (_) { /* fall through */ }
    return 'light';
  }

  const PROTECTED_JOINED = SEL.protected.join(',');
  function isProtected(el) {
    if (!el || !el.closest) return false;
    try { return el.closest(PROTECTED_JOINED) !== null; } catch (_) { return false; }
  }

  // A wrapper that merely contains a protected node (card, tool result, action bar) must never be hidden either.
  const DESCENDANT_GUARD = PROTECTED_JOINED + ',message-actions';
  function hasProtectedDescendant(el) {
    if (!el || !el.querySelector) return false;
    try { return el.querySelector(DESCENDANT_GUARD) !== null; } catch (_) { return true; }
  }

  const scannedLen = new WeakMap();
  const CANDIDATE_SEL = ':is(div,span,button,a,section):not([data-gopt-attribution]):not([data-gopt-owned])';

  function classify(el) {
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent || '').trim();
    const attrs = ((el.getAttribute('class') || '') + ' ' + (el.getAttribute('aria-label') || ''));
    const isChip = (tag === 'a' || tag === 'button' || tag === 'sup') &&
      text.length <= 24 && (CITATION_TEXT_RE.test(text) || CITATION_ATTR_RE.test(attrs));
    if (isChip) return 'chip';
    if (el.closest(PROSE_SEL)) return null;
    if (ATTRIBUTION_RE.test(text)) return 'attribution';
    if (APP_BADGE_RE.test(text)) {
      const role = el.getAttribute('role');
      const badge = tag === 'button' || tag === 'a' || role === 'button' || role === 'link';
      if (badge && !el.querySelector('img') && !/\n/.test(text)) {
        const h = el.getBoundingClientRect ? el.getBoundingClientRect().height : 0;
        if (h < 40) return 'badge';
      }
    }
    return null;
  }

  function tagDynamicAttributionNodes(rootArg) {
    const roots = Array.isArray(rootArg) ? rootArg : [rootArg];
    let tagged = 0;
    for (const r of roots) {
      if (!r || !r.querySelectorAll) continue;
      const responses = queryAll(r, SEL.modelResponse);
      if (r.matches && r.matches(SEL.modelResponse[0])) responses.unshift(r);
      for (const resp of responses) {
        const len = (resp.textContent || '').length;
        if (scannedLen.get(resp) === len) continue;
        scannedLen.set(resp, len);
        let cands;
        try { cands = resp.querySelectorAll(CANDIDATE_SEL); } catch (_) { continue; }
        for (const el of cands) {
          if (el.childElementCount > 6) continue;
          if ((el.textContent || '').length > 140) continue;
          if (isProtected(el)) continue;
          if (hasProtectedDescendant(el)) continue;
          if (!classify(el)) continue;
          el.setAttribute('data-gopt-attribution', '1');
          tagged++;
        }
      }
    }
    return tagged;
  }

  return Object.freeze({
    SEL, queryFirst, queryAll, findChatScroller, findMainArea, findComposerAnchor,
    findComposerInput, findDisclaimer, isVisible,
    getTurns, getTurnId, dedupePromptText, getPromptText,
    isTurnStreaming, detectTheme, isProtected, hasProtectedDescendant, tagDynamicAttributionNodes
  });
});
