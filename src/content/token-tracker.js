/* Gemini Web Optimizer - local token usage, plan detection & rolling 24h/7d quota tracker.
 * Pure core (estimateTokens, resolvePlan, recordConversationUsage, computeQuotaSnapshot) + body-mounted DOM adapter. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeminiOptTokenTracker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'goptTokenUsage';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;
  const MAX_CONV_ENTRIES = 200;
  const COUNTDOWN_TICK_MS = 60000;
  const DAILY_BASE_UNITS = 60000;
  const WEEKLY_BASE_UNITS = 300000;

  const PLAN_SPECS = Object.freeze({
    free:  Object.freeze({ id: 'free',  label: 'Free',     contextCap: 32000,   capLabel: '32k',  multiplier: 1,  dailyBudget: DAILY_BASE_UNITS * 1,  weeklyBudget: WEEKLY_BASE_UNITS * 1 }),
    plus:  Object.freeze({ id: 'plus',  label: 'AI Plus',  contextCap: 128000,  capLabel: '128k', multiplier: 2,  dailyBudget: DAILY_BASE_UNITS * 2,  weeklyBudget: WEEKLY_BASE_UNITS * 2 }),
    pro:   Object.freeze({ id: 'pro',   label: 'AI Pro',   contextCap: 1000000, capLabel: '1M',   multiplier: 4,  dailyBudget: DAILY_BASE_UNITS * 4,  weeklyBudget: WEEKLY_BASE_UNITS * 4 }),
    ultra: Object.freeze({ id: 'ultra', label: 'AI Ultra', contextCap: 1000000, capLabel: '1M',   multiplier: 20, dailyBudget: DAILY_BASE_UNITS * 20, weeklyBudget: WEEKLY_BASE_UNITS * 20 })
  });

  const MODEL_WEIGHTS = Object.freeze({
    flash: 1.0,
    pro: 1.6,
    deepResearch: 3.0
  });

  const CJK_RE = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/g;
  const PUNCT_RE = /[{}()[\]<>.,;:!?@#$%^&*+=|~`"'\\/_\-]/g;
  const BADGE_ULTRA_RE = /\b(ai\s*ultra|gemini\s*ultra|ultra)\b/i;
  const BADGE_PRO_RE = /\b(ai\s*pro|gemini\s*advanced|advanced)\b|^pro$/i;
  const BADGE_PLUS_RE = /\b(ai\s*plus|gemini\s*plus)\b|^plus$/i;
  const BADGE_FREE_RE = /\b(upgrade\s+to\s+gemini|get\s+gemini\s+advanced|try\s+gemini\s+advanced|upgrade|tingkatkan(\s+ke)?(\s+gemini)?|dapatkan\s+gemini\s+advanced)\b/i;
  const MODEL_PRO_RE = /\b(deep\s*research|2\.5\s*pro|3(\.\d+)?\s*pro|pro|thinking|argon|hydrogen|neon|tinggi|ultra|advanced)\b/i;
  const MODEL_FREE_RE = /\b(flash|fast|nano|lite|cepat)\b/i;
  const LIMIT_HINT_RE = /(reached.*limit|limit.*reached|rate limit|quota|too many requests|out of.*limit|mencapai batas|batas pesan|limit harian|kuota|coba lagi nanti|try again.*later|try again in \d)/i;
  const LIMIT_WEEKLY_RE = /\b(weekly|mingguan|7\s*days?|7\s*hari)\b/i;
  const LIMIT_TIME_RE = /(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?|\d+\s*(?:minutes?|mins?|min|menit|hours?|hrs?|hr|jam|days?|hari)\b)/i;

  function estimateTokens(raw) {
    if (!raw || typeof raw !== 'string') return 0;
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const cjkMatches = trimmed.match(CJK_RE);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const nonCjk = cjkCount > 0 ? trimmed.replace(CJK_RE, ' ') : trimmed;
    const punctMatches = nonCjk.match(PUNCT_RE);
    const punctCount = punctMatches ? punctMatches.length : 0;
    const words = nonCjk.trim() ? nonCjk.trim().split(/\s+/) : [];
    let wordTokens = 0;
    for (let i = 0; i < words.length; i++) {
      const len = words[i].length;
      if (len <= 4) wordTokens += 1;
      else if (len <= 9) wordTokens += 1.35;
      else wordTokens += Math.ceil(len / 3.7);
    }
    const total = Math.ceil(wordTokens + cjkCount * 1.55 + punctCount * 0.35);
    return Math.max(1, total);
  }

  function classifyPlanText(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    // Check upgrade/CTA patterns first so "Upgrade to Gemini Advanced / AI Pro" never misclassifies Free as paid.
    if (BADGE_FREE_RE.test(s)) return 'free';
    if (BADGE_ULTRA_RE.test(s)) return 'ultra';
    if (BADGE_PRO_RE.test(s)) return 'pro';
    if (BADGE_PLUS_RE.test(s)) return 'plus';
    return null;
  }

  function classifyModelTierText(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    if (MODEL_PRO_RE.test(s)) return 'pro';
    if (MODEL_FREE_RE.test(s)) return 'free';
    return null;
  }

  function detectModelWeight(text) {
    const s = String(text || '').trim();
    if (!s) return MODEL_WEIGHTS.flash;
    if (/deep\s*research/i.test(s)) return MODEL_WEIGHTS.deepResearch;
    if (MODEL_PRO_RE.test(s)) return MODEL_WEIGHTS.pro;
    return MODEL_WEIGHTS.flash;
  }

  function resolvePlan(opts) {
    const o = opts || {};
    if (o.badgePlan && PLAN_SPECS[o.badgePlan]) {
      return { plan: o.badgePlan, confidence: 'high' };
    }
    if (o.storedPlan && PLAN_SPECS[o.storedPlan]) {
      if (o.storedPlan === 'free' && o.modelPlan === 'pro') {
        return { plan: 'pro', confidence: 'model' };
      }
      return { plan: o.storedPlan, confidence: 'stored' };
    }
    if (o.modelPlan && PLAN_SPECS[o.modelPlan]) {
      return { plan: o.modelPlan, confidence: 'model' };
    }
    return { plan: 'free', confidence: 'default' };
  }

  function extractConversationId(url) {
    const m = /\/app\/([a-zA-Z0-9_-]+)/.exec(String(url || ''));
    return m ? m[1] : '__home__';
  }

  function nonNegNum(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function normalizeUsageStore(raw, now) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const plan = PLAN_SPECS[r.detectedPlan] ? r.detectedPlan : null;
    const conf = typeof r.planConfidence === 'string' ? r.planConfidence : 'default';

    let dailyUsed = nonNegNum(r.dailyUsed);
    let dailyStart = nonNegNum(r.dailyStart);
    if (dailyStart > 0 && ts >= dailyStart + DAY_MS) {
      dailyUsed = 0;
      dailyStart = 0;
    }

    let weeklyUsed = nonNegNum(r.weeklyUsed);
    let weeklyStart = nonNegNum(r.weeklyStart);
    if (weeklyStart > 0 && ts >= weeklyStart + WEEK_MS) {
      weeklyUsed = 0;
      weeklyStart = 0;
    }

    const srcConvs = r.conversations && typeof r.conversations === 'object' && !Array.isArray(r.conversations)
      ? r.conversations : {};
    const entries = [];
    for (const k of Object.keys(srcConvs)) {
      const c = srcConvs[k];
      if (!c || typeof c !== 'object') continue;
      entries.push([k, {
        maxTokens: nonNegNum(c.maxTokens),
        turnCount: nonNegNum(c.turnCount),
        updatedAt: nonNegNum(c.updatedAt)
      }]);
    }
    entries.sort(function (a, b) { return b[1].updatedAt - a[1].updatedAt; });
    const conversations = {};
    const keep = Math.min(entries.length, MAX_CONV_ENTRIES);
    for (let i = 0; i < keep; i++) conversations[entries[i][0]] = entries[i][1];

    return {
      detectedPlan: plan,
      planConfidence: plan ? conf : 'default',
      dailyUsed: dailyUsed,
      dailyStart: dailyStart,
      weeklyUsed: weeklyUsed,
      weeklyStart: weeklyStart,
      conversations: conversations
    };
  }

  function recordConversationUsage(store, opts) {
    const o = opts || {};
    const now = Number.isFinite(Number(o.now)) ? Number(o.now) : Date.now();
    const next = normalizeUsageStore(store, now);
    if (o.plan && PLAN_SPECS[o.plan]) {
      next.detectedPlan = o.plan;
      if (o.planConfidence) next.planConfidence = o.planConfidence;
    }

    const convId = o.convId;
    const turnCount = nonNegNum(o.turnCount);
    const chatTokens = nonNegNum(o.chatTokens);
    if (!convId || convId === '__home__') {
      return { store: next, deltaTokens: 0, chargedUnits: 0 };
    }

    const prev = next.conversations[convId];
    // Brand-new active conversation or zero-token pre-seed keeps baseline at 0 so Turn #1 charges once completed.
    if (!prev) {
      if (turnCount === 0 || chatTokens === 0) {
        if (o.isHydrated) {
          next.conversations[convId] = { maxTokens: 0, turnCount: 0, updatedAt: now };
        }
        return { store: next, deltaTokens: 0, chargedUnits: 0 };
      }
      if (!o.isHydrated) {
        next.conversations[convId] = { maxTokens: chatTokens, turnCount: turnCount, updatedAt: now };
        return { store: next, deltaTokens: 0, chargedUnits: 0 };
      }
    }

    if (!o.isHydrated) {
      const seededMax = Math.max(prev ? prev.maxTokens : 0, chatTokens);
      const seededTurns = Math.max(prev ? prev.turnCount : 0, turnCount);
      if (seededMax > 0 || seededTurns > 0) {
        next.conversations[convId] = { maxTokens: seededMax, turnCount: seededTurns, updatedAt: now };
      }
      return { store: next, deltaTokens: 0, chargedUnits: 0 };
    }

    if (prev && chatTokens > prev.maxTokens && turnCount >= prev.turnCount && turnCount > 0) {
      const deltaTokens = chatTokens - prev.maxTokens;
      const w = Number(o.modelWeight);
      const weight = Number.isFinite(w) && w > 0 ? w : 1.0;
      const chargedUnits = Math.round((chatTokens + deltaTokens * 2) * weight);
      if (next.dailyStart === 0) next.dailyStart = now;
      if (next.weeklyStart === 0) next.weeklyStart = now;
      next.dailyUsed += chargedUnits;
      next.weeklyUsed += chargedUnits;
      next.conversations[convId] = { maxTokens: chatTokens, turnCount: turnCount, updatedAt: now };
      return { store: normalizeUsageStore(next, now), deltaTokens: deltaTokens, chargedUnits: chargedUnits };
    }

    return { store: next, deltaTokens: 0, chargedUnits: 0 };
  }

  function detectLimitBannerText(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s || s.length > 260) return null;
    if (!LIMIT_HINT_RE.test(s)) return null;
    const scope = LIMIT_WEEKLY_RE.test(s) ? 'weekly' : 'daily';
    const tm = LIMIT_TIME_RE.exec(s);
    return { scope: scope, resetHint: tm ? tm[1] : '' };
  }

  function computeTierLevel(usedRatio) {
    if (usedRatio > 0.80) return 'crit';
    if (usedRatio > 0.50) return 'warn';
    return 'normal';
  }

  function computeRemainingLevel(leftPct) {
    if (leftPct < 20) return 'crit';
    if (leftPct < 50) return 'warn';
    return 'normal';
  }

  function formatCompactTokens(n) {
    const v = Math.max(0, Number(n) || 0);
    if (v >= 1000000) {
      const m = v / 1000000;
      return (Math.abs(m - Math.round(m)) < 0.05 ? Math.round(m) : m.toFixed(1)) + 'M';
    }
    if (v >= 1000) {
      if (v >= 100000) return Math.round(v / 1000) + 'k';
      const k = v / 1000;
      return (Math.abs(k - Math.round(k)) < 0.05 ? Math.round(k) : k.toFixed(1)) + 'k';
    }
    return String(Math.round(v));
  }

  function formatCountdown(ms) {
    if (!(ms > 0)) return '';
    const totalMins = Math.max(1, Math.ceil(ms / 60000));
    const days = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    const mins = totalMins % 60;
    if (days > 0) return days + 'd ' + hours + 'h';
    if (hours > 0) return hours + 'h ' + mins + 'm';
    return mins + 'm';
  }

  function formatResetClock(ts) {
    if (!(ts > 0)) return '';
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function computeQuotaSnapshot(store, opts) {
    const o = opts || {};
    const now = Number.isFinite(Number(o.now)) ? Number(o.now) : Date.now();
    const norm = normalizeUsageStore(store, now);
    const spec = PLAN_SPECS[o.plan || norm.detectedPlan] || PLAN_SPECS.free;

    const inputTokens = nonNegNum(o.inputTokens);
    const outputTokens = nonNegNum(o.outputTokens);
    const draftTokens = nonNegNum(o.draftTokens);
    const totalTokens = inputTokens + outputTokens + draftTokens;
    const ctxRatio = spec.contextCap > 0 ? totalTokens / spec.contextCap : 0;
    const ctxClamped = Math.min(1, Math.max(0, ctxRatio));
    const ctxPct = ctxRatio * 100;
    const ctxLevel = computeTierLevel(ctxRatio);

    const ban = o.limitBanner;
    const dailyHit = !!(ban && (ban.scope === 'daily' || ban.scope === 'both'));
    const weeklyHit = !!(ban && (ban.scope === 'weekly' || ban.scope === 'both'));

    const dailyRawLeft = spec.dailyBudget > 0
      ? Math.max(0, Math.min(100, (1 - norm.dailyUsed / spec.dailyBudget) * 100))
      : 100;
    const dailyLeftPct = dailyHit ? 0 : Math.round(dailyRawLeft);
    const dailyResetAt = norm.dailyUsed > 0 && norm.dailyStart > 0 ? norm.dailyStart + DAY_MS : 0;
    const dailyRemainingMs = dailyResetAt > now ? dailyResetAt - now : 0;
    const dailyLevel = computeRemainingLevel(dailyLeftPct);

    const weeklyRawLeft = spec.weeklyBudget > 0
      ? Math.max(0, Math.min(100, (1 - norm.weeklyUsed / spec.weeklyBudget) * 100))
      : 100;
    const weeklyLeftPct = weeklyHit ? 0 : Math.round(weeklyRawLeft);
    const weeklyResetAt = norm.weeklyUsed > 0 && norm.weeklyStart > 0 ? norm.weeklyStart + WEEK_MS : 0;
    const weeklyRemainingMs = weeklyResetAt > now ? weeklyResetAt - now : 0;
    const weeklyLevel = computeRemainingLevel(weeklyLeftPct);

    const pctStr = ctxPct >= 100 ? Math.round(ctxPct) + '%' : ctxPct.toFixed(1) + '%';
    const ctxText = '~' + formatCompactTokens(totalTokens) + ' / ' + spec.capLabel + ' (' + pctStr + ')';

    const dailyCd = formatCountdown(dailyRemainingMs) || (dailyHit && ban.resetHint ? ban.resetHint : '');
    const dailyText = (norm.dailyUsed === 0 && !dailyHit)
      ? 'Day 100% left'
      : 'Day ~' + dailyLeftPct + '% left' + (dailyCd ? ' (' + dailyCd + ')' : '');

    const weeklyCd = formatCountdown(weeklyRemainingMs) || (weeklyHit && ban.resetHint ? ban.resetHint : '');
    const weeklyText = (norm.weeklyUsed === 0 && !weeklyHit)
      ? 'Week 100% left'
      : 'Week ~' + weeklyLeftPct + '% left' + (weeklyCd ? ' (' + weeklyCd + ')' : '');

    return {
      plan: spec,
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      draftTokens: draftTokens,
      totalTokens: totalTokens,
      hasMedia: !!o.hasMedia,
      ctxRatio: ctxRatio,
      ctxClamped: ctxClamped,
      ctxLevel: ctxLevel,
      ctxText: ctxText,
      dailyLeftPct: dailyLeftPct,
      dailyLevel: dailyLevel,
      dailyText: dailyText,
      dailyCd: dailyCd,
      dailyResetAt: dailyResetAt,
      dailyIdle: norm.dailyUsed === 0 && !dailyHit,
      weeklyLeftPct: weeklyLeftPct,
      weeklyLevel: weeklyLevel,
      weeklyText: weeklyText,
      weeklyCd: weeklyCd,
      weeklyResetAt: weeklyResetAt,
      weeklyIdle: norm.weeklyUsed === 0 && !weeklyHit,
      planBadgeText: spec.label + ' \u00b7 ' + spec.capLabel,
      footerText: 'Estimated locally for ' + spec.label + ' (this browser)'
    };
  }

  // ---------- DOM adapter ----------
  const S = {
    doc: null,
    enabled: true,
    mounted: false,
    bar: null,
    fill: null,
    ctxEl: null,
    dayEl: null,
    weekEl: null,
    tip: null,
    tipBadge: null,
    tipIn: null,
    tipOut: null,
    tipDraft: null,
    tipMedia: null,
    tipTotal: null,
    tipDaily: null,
    tipWeekly: null,
    tipFooter: null,
    visible: false,
    tipVisible: false,
    tipTimer: 0,
    ro: null,
    roTargets: [],
    placeRaf: 0,
    trackRaf: 0,
    trackUntil: 0,
    tickTimer: 0,
    latePlaceTimer: 0,
    draftEl: null,
    draftTimer: 0,
    saveTimer: 0,
    dirtyStore: false,
    lastBarPos: '',
    lastFillTransform: '',
    turnCache: new WeakMap(),
    store: normalizeUsageStore(null, Date.now()),
    storeLoaded: false,
    hydratedConvId: null,
    lastUpdateArgs: { turns: [], streaming: false, wasStreaming: false, url: '' },
    hasMediaGlobal: false
  };

  function Sel() { return root.GeminiOptSelectors; }

  function storageArea() {
    return root.chrome && root.chrome.storage ? root.chrome.storage.local : null;
  }

  function loadUsageStore() {
    const area = storageArea();
    if (!area || typeof area.get !== 'function') {
      S.storeLoaded = true;
      return;
    }
    try {
      area.get(STORAGE_KEY, function (res) {
        if (root.chrome && root.chrome.runtime && root.chrome.runtime.lastError) {
          S.storeLoaded = true;
          return;
        }
        const loaded = normalizeUsageStore(res && res[STORAGE_KEY], Date.now());
        if (S.store) {
          if (Object.keys(S.store.conversations).length > 0) {
            loaded.conversations = Object.assign({}, loaded.conversations, S.store.conversations);
          }
          if (S.store.dailyUsed > 0) {
            loaded.dailyUsed += S.store.dailyUsed;
            if (!loaded.dailyStart) loaded.dailyStart = S.store.dailyStart;
          }
          if (S.store.weeklyUsed > 0) {
            loaded.weeklyUsed += S.store.weeklyUsed;
            if (!loaded.weeklyStart) loaded.weeklyStart = S.store.weeklyStart;
          }
          if (S.store.planConfidence === 'high' && S.store.detectedPlan) {
            loaded.detectedPlan = S.store.detectedPlan;
            loaded.planConfidence = 'high';
          }
        }
        S.store = normalizeUsageStore(loaded, Date.now());
        S.storeLoaded = true;
        if (S.mounted) update(S.lastUpdateArgs);
      });
    } catch (_) {
      S.storeLoaded = true;
    }
  }

  function flushPersist() {
    root.clearTimeout(S.saveTimer);
    S.saveTimer = 0;
    if (!S.dirtyStore) return;
    const area = storageArea();
    if (!area || typeof area.set !== 'function') return;
    S.dirtyStore = false;
    try {
      const obj = {};
      obj[STORAGE_KEY] = S.store;
      area.set(obj, function () { void (root.chrome && root.chrome.runtime && root.chrome.runtime.lastError); });
    } catch (_) { /* ignore */ }
  }

  function schedulePersist() {
    S.dirtyStore = true;
    const area = storageArea();
    if (!area || typeof area.set !== 'function') return;
    root.clearTimeout(S.saveTimer);
    S.saveTimer = root.setTimeout(flushPersist, 350);
  }

  function el(tag, cls, text) {
    const n = S.doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function makeRow(labelText) {
    const row = el('div', 'gopt-tk-row');
    const lbl = el('span', 'gopt-tk-lbl', labelText);
    const val = el('span', 'gopt-tk-val');
    row.appendChild(lbl);
    row.appendChild(val);
    return { row: row, val: val };
  }

  function ensureDom() {
    if (!S.doc || !S.doc.body || S.bar) return;

    const bar = el('div', 'gopt-token-bar');
    bar.setAttribute('data-gopt-owned', '');
    bar.setAttribute('tabindex', '0');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Token and quota usage');
    bar.setAttribute('aria-describedby', 'gopt-token-tooltip');

    const meter = el('span', 'gopt-tk-meter');
    meter.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'gopt-tk-fill');
    meter.appendChild(fill);

    const ctxEl = el('span', 'gopt-tk-ctx', '~0 / 32k (0.0%)');
    const sep1 = el('span', 'gopt-tk-sep', '\u00b7');
    sep1.setAttribute('aria-hidden', 'true');
    const dayEl = el('span', 'gopt-tk-day', 'Day 100% left');
    const sep2 = el('span', 'gopt-tk-sep', '\u00b7');
    sep2.setAttribute('aria-hidden', 'true');
    const weekEl = el('span', 'gopt-tk-week', 'Week 100% left');

    bar.appendChild(meter);
    bar.appendChild(ctxEl);
    bar.appendChild(sep1);
    bar.appendChild(dayEl);
    bar.appendChild(sep2);
    bar.appendChild(weekEl);

    const tip = el('div', 'gopt-tooltip gopt-token-tooltip');
    tip.id = 'gopt-token-tooltip';
    tip.setAttribute('data-gopt-owned', '');
    tip.setAttribute('role', 'tooltip');

    const head = el('div', 'gopt-tooltip-head');
    head.appendChild(el('span', 'gopt-tooltip-index', 'Context & Quota'));
    const tipBadge = el('span', 'gopt-tooltip-status', 'Free \u00b7 32k');
    head.appendChild(tipBadge);
    tip.appendChild(head);

    const grid = el('div', 'gopt-tk-grid');
    const rIn = makeRow('Input');
    const rOut = makeRow('Output');
    const rDraft = makeRow('Draft');
    const tipMedia = el('span', 'gopt-tk-media', '+ media');
    tipMedia.hidden = true;
    rDraft.row.appendChild(tipMedia);
    const rTotal = makeRow('Total');
    grid.appendChild(rIn.row);
    grid.appendChild(rOut.row);
    grid.appendChild(rDraft.row);
    grid.appendChild(rTotal.row);
    tip.appendChild(grid);

    tip.appendChild(el('div', 'gopt-tk-divider'));

    const qGrid = el('div', 'gopt-tk-grid');
    const rDaily = makeRow('Daily (24h)');
    const rWeekly = makeRow('Weekly (7d)');
    qGrid.appendChild(rDaily.row);
    qGrid.appendChild(rWeekly.row);
    tip.appendChild(qGrid);

    const tipFooter = el('div', 'gopt-tk-footer', 'Estimated locally for Free (this browser)');
    tip.appendChild(tipFooter);

    bar.addEventListener('pointerenter', function (ev) {
      if (ev.pointerType === 'touch') return;
      scheduleTipShow(80);
    });
    bar.addEventListener('pointerleave', hideTip);
    bar.addEventListener('focus', function () { scheduleTipShow(0); });
    bar.addEventListener('blur', hideTip);

    S.doc.body.appendChild(bar);
    S.doc.body.appendChild(tip);

    S.bar = bar;
    S.fill = fill;
    S.ctxEl = ctxEl;
    S.dayEl = dayEl;
    S.weekEl = weekEl;
    S.tip = tip;
    S.tipBadge = tipBadge;
    S.tipIn = rIn.val;
    S.tipOut = rOut.val;
    S.tipDraft = rDraft.val;
    S.tipMedia = tipMedia;
    S.tipTotal = rTotal.val;
    S.tipDaily = rDaily.val;
    S.tipWeekly = rWeekly.val;
    S.tipFooter = tipFooter;
  }

  function scheduleTipShow(delayMs) {
    if (!S.visible || !S.tip || !S.bar) return;
    root.clearTimeout(S.tipTimer);
    if (delayMs <= 0) {
      showTip();
    } else {
      S.tipTimer = root.setTimeout(showTip, delayMs);
    }
  }

  function showTip() {
    S.tipTimer = 0;
    if (!S.visible || !S.tip || !S.bar) return;
    S.tipVisible = true;
    placeTip();
    S.tip.classList.add('is-visible');
  }

  function hideTip() {
    root.clearTimeout(S.tipTimer);
    S.tipTimer = 0;
    S.tipVisible = false;
    if (S.tip) S.tip.classList.remove('is-visible');
  }

  function placeTip() {
    if (!S.tip || !S.bar || !S.visible) return;
    const br = S.bar.getBoundingClientRect();
    const tw = S.tip.offsetWidth || 260;
    const th = S.tip.offsetHeight || 120;
    const vw = root.innerWidth || 1200;
    const vh = root.innerHeight || 800;
    const left = Math.round(Math.max(8, Math.min(vw - tw - 8, br.left + (br.width - tw) / 2)));
    const top = Math.round(Math.max(8, Math.min(vh - th - 8, br.top - th - 8)));
    S.tip.style.left = left + 'px';
    S.tip.style.top = top + 'px';
  }

  function scanDomSignals(doc) {
    const Svc = Sel();
    if (!Svc || !doc) return { planRes: resolvePlan({ storedPlan: S.store.detectedPlan }), modelWeight: 1.0, limitBanner: null };

    let badgePlan = null;
    const badges = Svc.queryAll(doc, Svc.SEL.planBadge);
    for (const b of badges) {
      const candidate = (b.getAttribute && b.getAttribute('aria-label')) || b.textContent || '';
      const p = classifyPlanText(candidate);
      if (p) { badgePlan = p; break; }
    }
    if (!badgePlan) {
      const sidenav = Svc.queryFirst(doc, Svc.SEL.sidenav);
      if (sidenav && sidenav.querySelectorAll) {
        let nodes = [];
        try { nodes = sidenav.querySelectorAll('div, span, p'); } catch (_) { nodes = []; }
        for (let i = nodes.length - 1; i >= 0; i--) {
          const el = nodes[i];
          if (el.childElementCount > 0) continue;
          if (el.closest && el.closest('a[href*="/app/"], [data-gopt-owned], [role="listitem"]')) continue;
          const t = (el.textContent || '').trim();
          if (t && t.length <= 24 && /^(ai\s*)?(ultra|pro|plus|advanced)$/i.test(t)) {
            const p = classifyPlanText(t);
            if (p) { badgePlan = p; break; }
          }
        }
      }
    }

    let modelPlan = null;
    let modelText = '';
    const models = Svc.queryAll(doc, Svc.SEL.modelSelector);
    for (const m of models) {
      if (!Svc.isVisible(m)) continue;
      const t = (m.textContent || (m.getAttribute && m.getAttribute('aria-label')) || '').trim();
      if (!t) continue;
      modelText = t;
      modelPlan = classifyModelTierText(t);
      if (modelPlan) break;
    }

    const planRes = resolvePlan({
      badgePlan: badgePlan,
      modelPlan: modelPlan,
      storedPlan: S.store.detectedPlan
    });

    let limitBanner = null;
    const banners = Svc.queryAll(doc, Svc.SEL.limitBanner);
    for (const el of banners) {
      if (!Svc.isVisible(el)) continue;
      if (el.closest && el.closest('model-response, user-query, [data-gopt-owned], [data-gopt-attribution]')) continue;
      const parsed = detectLimitBannerText(el.textContent);
      if (parsed) { limitBanner = parsed; break; }
    }

    return {
      planRes: planRes,
      modelWeight: detectModelWeight(modelText),
      limitBanner: limitBanner
    };
  }

  function measureTurns(turns) {
    const Svc = Sel();
    if (!Svc || !turns || !turns.length) {
      return { inputTokens: 0, outputTokens: 0, hasMedia: false };
    }
    let inputTokens = 0;
    let outputTokens = 0;
    let hasMedia = false;

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (!turn) continue;
      const uq = Svc.queryFirst(turn, Svc.SEL.userQuery);
      const mr = Svc.queryFirst(turn, Svc.SEL.modelResponse);
      const uText = uq ? (uq.textContent || '') : '';
      const mText = mr ? (mr.textContent || '') : '';
      const uLen = uText.length;
      const mLen = mText.length;
      const cached = S.turnCache.get(turn);
      if (cached && cached.uLen === uLen && cached.mLen === mLen) {
        inputTokens += cached.inTok;
        outputTokens += cached.outTok;
        if (cached.media) hasMedia = true;
        continue;
      }
      const inTok = uLen > 0 ? estimateTokens(uText) : 0;
      const outTok = mLen > 0 ? estimateTokens(mText) : 0;
      const media = !!(turn.querySelector && turn.querySelector('img:not([data-gopt-owned] *), video, canvas, [class*="attachment"]'));
      S.turnCache.set(turn, { uLen: uLen, mLen: mLen, inTok: inTok, outTok: outTok, media: media });
      inputTokens += inTok;
      outputTokens += outTok;
      if (media) hasMedia = true;
    }
    return { inputTokens: inputTokens, outputTokens: outputTokens, hasMedia: hasMedia };
  }

  function readDraftInfo(doc) {
    const Svc = Sel();
    const inputEl = Svc && doc ? Svc.findComposerInput(doc) : null;
    if (inputEl !== S.draftEl) {
      if (S.draftEl) S.draftEl.removeEventListener('input', onDraftInput);
      S.draftEl = inputEl;
      if (S.draftEl) S.draftEl.addEventListener('input', onDraftInput, { passive: true });
    }
    const text = inputEl ? (inputEl.value !== undefined ? inputEl.value : (inputEl.textContent || '')) : '';
    const anchor = Svc && doc ? Svc.findComposerAnchor(doc) : null;
    const draftMedia = !!(anchor && anchor.querySelector && anchor.querySelector('[class*="attachment"], [data-test-id*="attachment" i], img:not(button img)'));
    return { draftTokens: estimateTokens(text), hasMedia: draftMedia };
  }

  function onDraftInput() {
    root.clearTimeout(S.draftTimer);
    S.draftTimer = root.setTimeout(function () {
      S.draftTimer = 0;
      update(S.lastUpdateArgs);
    }, 120);
  }

  function syncCountdownTimer(active) {
    if (active && !S.tickTimer) {
      S.tickTimer = root.setInterval(function () {
        if (S.visible) update(S.lastUpdateArgs);
      }, COUNTDOWN_TICK_MS);
    } else if (!active && S.tickTimer) {
      root.clearInterval(S.tickTimer);
      S.tickTimer = 0;
    }
  }

  function placeBar() {
    S.placeRaf = 0;
    if (!S.bar || !S.doc || !S.visible) return;
    S.bar.classList.add('is-visible');
    if (S.doc.documentElement) S.doc.documentElement.classList.add('gopt-token-bar-active');

    const Svc = Sel();
    const vw = root.innerWidth || 1200;
    const vh = root.innerHeight || 800;
    const anchor = Svc ? Svc.findComposerAnchor(S.doc) : null;
    const box = anchor && anchor.querySelector ? (anchor.querySelector('.text-input-field, rich-textarea') || anchor) : anchor;
    const br = box && box.getBoundingClientRect ? box.getBoundingClientRect() : null;
    const cr = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    const mainEl = Svc ? (Svc.findChatScroller(S.doc) || Svc.queryFirst(S.doc, Svc.SEL.mainArea)) : null;
    const sr = mainEl && mainEl.getBoundingClientRect ? mainEl.getBoundingClientRect() : null;
    const disc = Svc && Svc.findDisclaimer ? Svc.findDisclaimer(S.doc) : null;
    const dr = disc && disc.getBoundingClientRect ? disc.getBoundingClientRect() : null;

    let rawLeft = 16;
    let rawW = vw - 32;
    if (br && br.width > 0) {
      rawLeft = br.left;
      rawW = br.width;
    } else if (cr && cr.width > 0) {
      rawLeft = cr.left + 44;
      rawW = Math.max(200, cr.width - 118);
    } else if (sr && sr.width > 0) {
      rawLeft = sr.left + 44;
      rawW = Math.max(200, sr.width - 118);
    }

    const left = Math.round(Math.max(8, Math.min(vw - 168, rawLeft)));
    const width = Math.round(Math.max(160, Math.min(vw - left - 8, rawW)));
    const barH = 22;

    let bottomPx = 4;
    if (dr && dr.height > 0 && dr.bottom <= vh + 2 && (!cr || cr.bottom === 0 || dr.top >= cr.bottom - 6)) {
      bottomPx = Math.max(2, Math.min(40, Math.round(vh - (dr.top + (dr.height + barH) / 2))));
    } else if (cr && cr.bottom > 0 && vh - cr.bottom >= barH + 2) {
      bottomPx = Math.max(2, Math.min(40, Math.round((vh - cr.bottom - barH) / 2)));
    }

    const key = left + '|' + bottomPx + '|' + width;
    if (key !== S.lastBarPos) {
      S.lastBarPos = key;
      S.bar.style.left = left + 'px';
      S.bar.style.width = width + 'px';
      S.bar.style.bottom = bottomPx + 'px';
      S.bar.style.top = '';
    }
    if (S.tipVisible) placeTip();
  }

  function schedulePlace() {
    if (!S.mounted || !S.visible || S.placeRaf) return;
    if (typeof root.requestAnimationFrame === 'function') {
      S.placeRaf = root.requestAnimationFrame(placeBar);
    } else {
      placeBar();
    }
  }

  function sameElements(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function attachObservers() {
    if (typeof root.ResizeObserver !== 'function' || !S.doc) return;
    if (!S.ro) {
      S.ro = new root.ResizeObserver(function () { schedulePlace(); });
    }
    const Svc = Sel();
    const targets = Svc ? [
      Svc.findComposerAnchor(S.doc),
      Svc.queryFirst(S.doc, Svc.SEL.mainArea),
      Svc.queryFirst(S.doc, Svc.SEL.sidenav)
    ].filter(Boolean) : [];
    if (!sameElements(S.roTargets, targets)) {
      S.ro.disconnect();
      S.roTargets = targets;
      for (const el of targets) S.ro.observe(el);
    }
  }

  function renderSnapshot(snap) {
    ensureDom();
    if (!S.bar) return;
    const tStr = 'scaleX(' + snap.ctxClamped.toFixed(4) + ')';
    if (tStr !== S.lastFillTransform) {
      S.lastFillTransform = tStr;
      S.fill.style.transform = tStr;
    }
    S.fill.setAttribute('data-level', snap.ctxLevel);
    S.ctxEl.setAttribute('data-level', snap.ctxLevel);
    S.dayEl.setAttribute('data-level', snap.dailyLevel);
    S.weekEl.setAttribute('data-level', snap.weeklyLevel);

    if (S.ctxEl.textContent !== snap.ctxText) S.ctxEl.textContent = snap.ctxText;
    if (S.dayEl.textContent !== snap.dailyText) S.dayEl.textContent = snap.dailyText;
    if (S.weekEl.textContent !== snap.weeklyText) S.weekEl.textContent = snap.weeklyText;

    if (S.tipBadge.textContent !== snap.planBadgeText) S.tipBadge.textContent = snap.planBadgeText;
    S.tipIn.textContent = '~' + formatCompactTokens(snap.inputTokens) + ' tokens';
    S.tipOut.textContent = '~' + formatCompactTokens(snap.outputTokens) + ' tokens';
    S.tipDraft.textContent = '~' + formatCompactTokens(snap.draftTokens) + ' tokens';
    S.tipMedia.hidden = !snap.hasMedia;
    const fullCap = snap.plan.contextCap >= 1000000 ? '1,000,000' : snap.plan.contextCap.toLocaleString('en-US');
    const pctStr = snap.ctxRatio * 100 >= 100 ? Math.round(snap.ctxRatio * 100) + '%' : (snap.ctxRatio * 100).toFixed(1) + '%';
    S.tipTotal.textContent = '~' + formatCompactTokens(snap.totalTokens) + ' / ' + fullCap + ' (' + pctStr + ')';

    const dClock = formatResetClock(snap.dailyResetAt);
    S.tipDaily.textContent = snap.dailyIdle
      ? '100% left'
      : '~' + snap.dailyLeftPct + '% left' + (snap.dailyCd ? ' \u00b7 resets in ' + snap.dailyCd : '') + (dClock ? ' (' + dClock + ')' : '');
    const wClock = formatResetClock(snap.weeklyResetAt);
    S.tipWeekly.textContent = snap.weeklyIdle
      ? '100% left'
      : '~' + snap.weeklyLeftPct + '% left' + (snap.weeklyCd ? ' \u00b7 resets in ' + snap.weeklyCd : '') + (wClock ? ' (' + wClock + ')' : '');
    if (S.tipFooter.textContent !== snap.footerText) S.tipFooter.textContent = snap.footerText;
  }

  function setVisible(on) {
    S.visible = on;
    if (S.doc && S.doc.documentElement) {
      S.doc.documentElement.classList.toggle('gopt-token-bar-active', on);
    }
    if (S.bar) {
      S.bar.classList.toggle('is-visible', on);
    }
    if (!on) {
      hideTip();
      if (S.latePlaceTimer) { root.clearTimeout(S.latePlaceTimer); S.latePlaceTimer = 0; }
    } else {
      schedulePlace();
      if (!S.latePlaceTimer && typeof root.setTimeout === 'function') {
        S.latePlaceTimer = root.setTimeout(function () {
          S.latePlaceTimer = 0;
          if (S.visible) schedulePlace();
        }, 150);
      }
    }
    syncCountdownTimer(on);
  }

  function mount(doc) {
    S.doc = doc || root.document;
    if (!S.doc || S.mounted) return;
    S.mounted = true;
    loadUsageStore();
    ensureDom();
    attachObservers();
    if (root.addEventListener) root.addEventListener('resize', schedulePlace, { passive: true });
  }

  function setEnabled(on) {
    S.enabled = !!on;
    if (!S.enabled) {
      setVisible(false);
    } else if (S.mounted) {
      update(S.lastUpdateArgs);
    }
  }

  function update(opts) {
    if (!S.mounted || !S.doc) return;
    const o = opts || S.lastUpdateArgs || {};
    S.lastUpdateArgs = {
      turns: Array.isArray(o.turns) ? o.turns : [],
      streaming: !!o.streaming,
      wasStreaming: !!o.wasStreaming,
      url: o.url !== undefined ? o.url : (root.location ? root.location.href : ''),
      doc: o.doc || S.doc
    };

    const turns = S.lastUpdateArgs.turns;
    const doc = S.lastUpdateArgs.doc;
    const draft = readDraftInfo(doc);

    if (!S.enabled) {
      setVisible(false);
      return;
    }

    const signals = scanDomSignals(doc);
    const persistablePlan = (signals.planRes.confidence === 'high' || signals.planRes.confidence === 'model')
      ? signals.planRes.plan : null;
    const persistableConf = persistablePlan ? signals.planRes.confidence : null;
    const prevPlan = S.store.detectedPlan;
    const prevConf = S.store.planConfidence;
    const planChanged = !!persistablePlan && (prevPlan !== persistablePlan || prevConf !== persistableConf);

    const measured = measureTurns(turns);
    const chatTokens = measured.inputTokens + measured.outputTokens;
    const convId = extractConversationId(S.lastUpdateArgs.url);
    const now = Date.now();

    let res = { store: normalizeUsageStore(S.store, now), deltaTokens: 0, chargedUnits: 0 };
    if (convId !== '__home__' && turns.length > 0) {
      const firstSight = S.hydratedConvId !== convId;
      if (firstSight) {
        if (S.lastUpdateArgs.streaming) {
          // Brand-new response streaming on first observation of convId: pre-seed 0 and wait for completion.
          S.hydratedConvId = convId;
          res = recordConversationUsage(S.store, {
            convId: convId, turnCount: 0, chatTokens: 0,
            modelWeight: signals.modelWeight, isHydrated: true, now: now,
            plan: persistablePlan, planConfidence: persistableConf
          });
        } else {
          // Existing populated non-streaming chat: hydrate high-water mark with zero quota charge.
          S.hydratedConvId = convId;
          res = recordConversationUsage(S.store, {
            convId: convId, turnCount: turns.length, chatTokens: chatTokens,
            modelWeight: signals.modelWeight, isHydrated: false, now: now,
            plan: persistablePlan, planConfidence: persistableConf
          });
        }
      } else if (!S.lastUpdateArgs.streaming) {
        res = recordConversationUsage(S.store, {
          convId: convId, turnCount: turns.length, chatTokens: chatTokens,
          modelWeight: signals.modelWeight, isHydrated: true, now: now,
          plan: persistablePlan, planConfidence: persistableConf
        });
      } else if (persistablePlan) {
        res.store.detectedPlan = persistablePlan;
        res.store.planConfidence = persistableConf;
      }
    } else if (convId !== '__home__' && turns.length === 0) {
      S.hydratedConvId = convId;
      res = recordConversationUsage(S.store, {
        convId: convId, turnCount: 0, chatTokens: 0,
        modelWeight: signals.modelWeight, isHydrated: true, now: now,
        plan: persistablePlan, planConfidence: persistableConf
      });
    } else if (persistablePlan) {
      res.store.detectedPlan = persistablePlan;
      res.store.planConfidence = persistableConf;
    }

    S.store = res.store;
    if (res.chargedUnits > 0 || (firstPlanPersistNeeded(prevPlan, prevConf, signals.planRes) && planChanged)) {
      schedulePersist();
    } else if (res.store.conversations[convId] && S.storeLoaded && planChanged) {
      schedulePersist();
    }

    const show = turns.length > 0 || draft.draftTokens > 0;
    if (!show) {
      setVisible(false);
      return;
    }

    const snap = computeQuotaSnapshot(S.store, {
      plan: signals.planRes.plan,
      inputTokens: measured.inputTokens,
      outputTokens: measured.outputTokens,
      draftTokens: draft.draftTokens,
      hasMedia: measured.hasMedia || draft.hasMedia,
      limitBanner: signals.limitBanner,
      now: now
    });
    renderSnapshot(snap);
    attachObservers();
    setVisible(true);
  }

  function firstPlanPersistNeeded(prevPlan, prevConf, nextRes) {
    return nextRes.confidence === 'high' && (prevPlan !== nextRes.plan || prevConf !== 'high');
  }

  function startSmoothTrack(durationMs) {
    if (!S.mounted) return;
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const until = now + (durationMs || 280);
    if (until > S.trackUntil) S.trackUntil = until;
    if (S.trackRaf) return;
    const step = function () {
      S.trackRaf = 0;
      placeBar();
      const cur = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      if (cur < S.trackUntil && S.visible) {
        if (typeof root.requestAnimationFrame === 'function') S.trackRaf = root.requestAnimationFrame(step);
      }
    };
    if (typeof root.requestAnimationFrame === 'function') S.trackRaf = root.requestAnimationFrame(step);
  }

  function resetRoute() {
    S.hydratedConvId = null;
    S.lastBarPos = '';
    S.lastUpdateArgs = { turns: [], streaming: false, wasStreaming: false, url: root.location ? root.location.href : '', doc: S.doc };
    if (S.draftEl) {
      S.draftEl.removeEventListener('input', onDraftInput);
      S.draftEl = null;
    }
    setVisible(false);
  }

  function destroy() {
    S.mounted = false;
    flushPersist();
    setVisible(false);
    root.clearTimeout(S.draftTimer); S.draftTimer = 0;
    root.clearTimeout(S.tipTimer); S.tipTimer = 0;
    root.clearTimeout(S.latePlaceTimer); S.latePlaceTimer = 0;
    syncCountdownTimer(false);
    if (root.removeEventListener) root.removeEventListener('resize', schedulePlace);
    if (S.placeRaf && typeof root.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(S.placeRaf);
      S.placeRaf = 0;
    }
    if (S.trackRaf && typeof root.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(S.trackRaf);
      S.trackRaf = 0;
    }
    if (S.ro) { S.ro.disconnect(); S.ro = null; }
    S.roTargets = [];
    if (S.draftEl) { S.draftEl.removeEventListener('input', onDraftInput); S.draftEl = null; }
    if (S.bar && S.bar.remove) S.bar.remove();
    if (S.tip && S.tip.remove) S.tip.remove();
    S.bar = null;
    S.tip = null;
    S.doc = null;
  }

  return Object.freeze({
    STORAGE_KEY, DAY_MS, WEEK_MS, MAX_CONV_ENTRIES, PLAN_SPECS, MODEL_WEIGHTS,
    estimateTokens, classifyPlanText, classifyModelTierText, detectModelWeight, resolvePlan,
    extractConversationId, normalizeUsageStore, recordConversationUsage, computeQuotaSnapshot,
    formatCompactTokens, formatCountdown, computeTierLevel, computeRemainingLevel, detectLimitBannerText,
    mount, setEnabled, update, startSmoothTrack, resetRoute, destroy
  });
});
