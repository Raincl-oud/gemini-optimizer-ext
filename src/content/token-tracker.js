/* Gemini Web Optimizer - context token counter, official /usage background sync & usage bar.
 * Pure core (estimateTokens, parseUsagePageText, parseResetTimestamp, resolvePlan, computeQuotaSnapshot) + DOM adapter. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeminiOptTokenTracker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'goptTokenUsage';
  const COUNTDOWN_TICK_MS = 60000;
  const SCRAPE_POLL_MS = 200;
  const SCRAPE_MAX_MS = 14000;
  const SCRAPE_WEEKLY_GRACE_MS = 1500;
  const SYNC_SETTLE_MS = 1800;
  const SYNC_IDLE_DEFER_MS = 500;
  const SYNC_MAX_DEFER_MS = 6000;
  const MANUAL_SYNC_TIMEOUT_MS = 16000;
  const WINDOW_5H_MS = 5 * 3600 * 1000;
  const WINDOW_WEEK_MS = 7 * 24 * 3600 * 1000;

  const PLAN_SPECS = Object.freeze({
    free:  Object.freeze({ id: 'free',  label: 'Free',     contextCap: 32000,   capLabel: '32k' }),
    plus:  Object.freeze({ id: 'plus',  label: 'AI Plus',  contextCap: 128000,  capLabel: '128k' }),
    pro:   Object.freeze({ id: 'pro',   label: 'AI Pro',   contextCap: 1000000, capLabel: '1M' }),
    ultra: Object.freeze({ id: 'ultra', label: 'AI Ultra', contextCap: 1000000, capLabel: '1M' })
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

  const USAGE_CUR_RE = /(penggunaan\s+saat\s+ini|current\s+usage|5[-\s]*hour\s+limit|batas\s+5\s+jam)/i;
  const USAGE_WEEK_RE = /(batas\s+mingguan|weekly\s+limit|weekly\s+usage)/i;
  const USAGE_UPSELL_RE = /(dapatkan\s+penggunaan|get\s+\d+x\s+more|upgrade\s+to|tingkatkan\s+ke|\bupgrade\b)/i;
  const USAGE_PCT_RE = /(\d{1,3})\s*%\s*(?:(tersisa|left|remaining)|(digunakan|terpakai|used))?/i;
  const USAGE_RESET_LINE_RE = /((?:direset|resets?|reset)\b[^\n\r]*(?:\n\s*(?:pukul|jam|at)\b[^\n\r]*)?)/i;

  const MONTHS = Object.freeze({
    jan: 0, january: 0, januari: 0,
    feb: 1, february: 1, februari: 1,
    mar: 2, march: 2, maret: 2,
    apr: 3, april: 3,
    may: 4, mei: 4,
    jun: 5, june: 5, juni: 5,
    jul: 6, july: 6, juli: 6,
    aug: 7, august: 7, agustus: 7, agu: 7, agt: 7,
    sep: 8, september: 8, sept: 8,
    oct: 9, october: 9, oktober: 9, okt: 9,
    nov: 10, november: 10, nop: 10,
    dec: 11, december: 11, desember: 11, des: 11
  });

  const MONTH_KEY_PAT = 'jan(?:uari|uary)?|feb(?:ruari|ruary)?|mar(?:et|ch)?|apr(?:il)?|may|mei|jun(?:i|e)?|jul(?:i|y)?|aug(?:ust)?|agustus|agu|agt|sep(?:t(?:ember)?)?|oct(?:ober)?|okt(?:ober)?|nov(?:ember)?|nop|dec(?:ember)?|des(?:ember)?';
  const DATE_DM_RE = new RegExp('\\b(\\d{1,2})\\s+(' + MONTH_KEY_PAT + ')\\b', 'i');
  const DATE_MD_RE = new RegExp('\\b(' + MONTH_KEY_PAT + ')\\s+(\\d{1,2})\\b', 'i');
  const TIME_RE = /(?:pukul|jam|at)?\s*\b(\d{1,2})[:.](\d{2})(?:\s*(am|pm))?\b|(?:pukul|jam|at)\s+(\d{1,2})\s*(am|pm)\b/i;
  const REL_TIME_RE = /(?:\bdalam\b|\bin\b)\s*(?:(\d+)\s*(?:hari|days?|d)\b\s*)?(?:(\d+)\s*(?:jam|hours?|hrs?|h)\b\s*)?(?:(\d+)\s*(?:menit|minutes?|mins?|m)\b)?/i;

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

  function nonNegNum(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function clampPct(v) {
    if (v === null || v === undefined || typeof v === 'boolean' || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const r = Math.round(n);
    return Math.min(100, Math.max(0, r === 0 ? 0 : r));
  }

  function parseResetTimestamp(resetLine, now, kind) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const s = String(resetLine || '').replace(/\s+/g, ' ').trim();
    if (!s) return 0;

    const rel = REL_TIME_RE.exec(s);
    if (rel && (rel[1] || rel[2] || rel[3])) {
      const mins = (Number(rel[1] || 0) * 1440) + (Number(rel[2] || 0) * 60) + Number(rel[3] || 0);
      if (mins > 0) return ts + mins * 60000;
    }

    let monthIdx = null;
    let dayNum = null;
    let tmText = s;
    const dm = DATE_DM_RE.exec(s);
    const md = !dm ? DATE_MD_RE.exec(s) : null;
    if (dm) {
      const mk = dm[2].toLowerCase();
      monthIdx = MONTHS[mk] !== undefined ? MONTHS[mk] : MONTHS[mk.slice(0, 3)];
      dayNum = Number(dm[1]);
      tmText = s.slice(0, dm.index) + ' ' + s.slice(dm.index + dm[0].length);
    } else if (md) {
      const mk = md[1].toLowerCase();
      monthIdx = MONTHS[mk] !== undefined ? MONTHS[mk] : MONTHS[mk.slice(0, 3)];
      dayNum = Number(md[2]);
      tmText = s.slice(0, md.index) + ' ' + s.slice(md.index + md[0].length);
    }

    const tm = TIME_RE.exec(tmText);
    if (!tm && monthIdx === null) return 0;

    let rawH = 0;
    let M = 0;
    let ampm = '';
    if (tm) {
      rawH = Number(tm[1] !== undefined ? tm[1] : tm[4]);
      M = Number(tm[2] !== undefined ? tm[2] : 0);
      ampm = (tm[3] || tm[5] || '').toLowerCase();
      if (rawH < 0 || rawH > 23 || M < 0 || M > 59) return 0;
    }

    let hours;
    if (!tm) {
      hours = [0];
    } else if (ampm === 'pm') {
      hours = [rawH < 12 ? rawH + 12 : rawH];
    } else if (ampm === 'am') {
      hours = [rawH === 12 ? 0 : rawH];
    } else if (rawH >= 1 && rawH <= 11) {
      hours = [rawH, rawH + 12];
    } else if (rawH === 12 && kind !== 'weekly') {
      hours = [12, 0];
    } else {
      hours = [rawH];
    }

    const d = new Date(ts);
    if (monthIdx !== null && dayNum >= 1 && dayNum <= 31) {
      const minW = ts - 12 * 3600000;
      const maxW = ts + 8 * 86400000;
      let bestWin = Infinity;
      let bestFallback = Infinity;
      for (let yo = 0; yo <= 1; yo++) {
        const y = d.getFullYear() + yo;
        for (let hi = 0; hi < hours.length; hi++) {
          const c = new Date(y, monthIdx, dayNum, hours[hi], M, 0, 0);
          if (c.getMonth() !== monthIdx || c.getDate() !== dayNum) continue;
          const t = c.getTime();
          if (t >= minW && t <= maxW && t < bestWin) bestWin = t;
          if (t >= minW && t < bestFallback) bestFallback = t;
        }
      }
      if (bestWin < Infinity) return bestWin;
      return bestFallback < Infinity ? bestFallback : 0;
    }

    if (kind === 'weekly') {
      let bestW = Infinity;
      for (let dayOff = 0; dayOff <= 1; dayOff++) {
        for (let hi = 0; hi < hours.length; hi++) {
          const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOff, hours[hi], M, 0, 0).getTime();
          if (t > ts && t < bestW) bestW = t;
        }
      }
      return bestW < Infinity ? bestW : 0;
    }

    const winMin = ts - 2 * 60000;
    const winMax = ts + (5 * 60 + 15) * 60000;
    let bestInWindow = Infinity;
    let bestExact = -Infinity;
    let bestAfter = Infinity;
    for (let dayOff = 0; dayOff <= 1; dayOff++) {
      for (let hi = 0; hi < hours.length; hi++) {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOff, hours[hi], M, 0, 0).getTime();
        if (t > ts && t <= winMax && t < bestInWindow) bestInWindow = t;
        if (t > winMin && t <= ts && t > bestExact) bestExact = t;
        if (t > ts && t < bestAfter) bestAfter = t;
      }
    }
    if (bestInWindow < Infinity) return bestInWindow;
    if (bestExact > -Infinity) return Math.max(bestExact, ts);
    return bestAfter < Infinity ? bestAfter : 0;
  }

  function parseUsageSection(slice, now, kind) {
    if (!slice) return { pct: null, resetAt: 0 };
    const pm = USAGE_PCT_RE.exec(slice);
    let pct = null;
    if (pm) {
      const n = Number(pm[1]);
      if (Number.isFinite(n)) pct = clampPct(pm[2] ? 100 - n : n);
    }
    const rm = USAGE_RESET_LINE_RE.exec(slice);
    const resetAt = rm ? parseResetTimestamp(rm[1], now, kind) : 0;
    return { pct: pct, resetAt: resetAt };
  }

  function parseUsagePageText(text, now) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const raw = String(text || '').replace(/\r\n?/g, '\n');
    const curM = USAGE_CUR_RE.exec(raw);
    const weekM = USAGE_WEEK_RE.exec(raw);

    const headEnd = curM ? curM.index : (weekM ? weekM.index : Math.min(raw.length, 320));
    const headRaw = raw.slice(0, headEnd);
    const headUpM = USAGE_UPSELL_RE.exec(headRaw);
    const headerSlice = headUpM ? headRaw.slice(0, headUpM.index) : headRaw;

    let detectedPlan = null;
    if (/\b(ai\s*ultra|gemini\s*ultra|ultra)\b/i.test(headerSlice)) detectedPlan = 'ultra';
    else if (/\b(ai\s*pro|gemini\s*advanced|advanced|pro)\b/i.test(headerSlice)) detectedPlan = 'pro';
    else if (/\b(ai\s*plus|gemini\s*plus|plus)\b/i.test(headerSlice)) detectedPlan = 'plus';
    else if (/\b(free|gratis)\b/i.test(headerSlice)) detectedPlan = 'free';

    let window5hPct = null;
    let window5hResetAt = 0;
    if (curM) {
      const cStart = curM.index + curM[0].length;
      const cEnd = weekM && weekM.index > cStart ? weekM.index : cStart + 400;
      let slice5h = raw.slice(cStart, cEnd);
      const up5 = USAGE_UPSELL_RE.exec(slice5h);
      if (up5) slice5h = slice5h.slice(0, up5.index);
      const parsed5h = parseUsageSection(slice5h, ts, '5h');
      window5hPct = parsed5h.pct;
      window5hResetAt = parsed5h.resetAt;
    }

    let weeklyPct = null;
    let weeklyResetAt = 0;
    if (weekM) {
      const wStart = weekM.index + weekM[0].length;
      let sliceWeek = raw.slice(wStart, wStart + 360);
      const upW = USAGE_UPSELL_RE.exec(sliceWeek);
      if (upW) sliceWeek = sliceWeek.slice(0, upW.index);
      const parsedWeek = parseUsageSection(sliceWeek, ts, 'weekly');
      weeklyPct = parsedWeek.pct;
      weeklyResetAt = parsedWeek.resetAt;
    }

    return {
      detectedPlan: detectedPlan,
      planConfidence: detectedPlan ? 'high' : 'default',
      syncedAt: ts,
      window5hPct: window5hPct,
      window5hResetAt: window5hResetAt,
      weeklyPct: weeklyPct,
      weeklyResetAt: weeklyResetAt
    };
  }

  function normalizeUsageStore(raw, now) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const plan = PLAN_SPECS[r.detectedPlan] ? r.detectedPlan : null;
    const conf = typeof r.planConfidence === 'string' ? r.planConfidence : 'default';
    const syncedAt = nonNegNum(r.syncedAt);
    let window5hResetProvisional = !!r.window5hResetProvisional;
    let weeklyResetProvisional = !!r.weeklyResetProvisional;

    if (syncedAt <= 0 && !window5hResetProvisional && !weeklyResetProvisional) {
      return {
        detectedPlan: plan,
        planConfidence: plan ? conf : 'default',
        syncedAt: 0,
        window5hPct: null,
        window5hResetAt: 0,
        window5hResetProvisional: false,
        weeklyPct: null,
        weeklyResetAt: 0,
        weeklyResetProvisional: false
      };
    }

    let window5hPct = clampPct(r.window5hPct);
    let window5hResetAt = nonNegNum(r.window5hResetAt);
    if (window5hResetAt > 0 && ts >= window5hResetAt) {
      window5hPct = 0;
      window5hResetAt = 0;
      window5hResetProvisional = false;
    } else if (window5hResetAt === 0) {
      window5hResetProvisional = false;
    }

    let weeklyPct = clampPct(r.weeklyPct);
    let weeklyResetAt = nonNegNum(r.weeklyResetAt);
    if (weeklyResetAt > 0 && ts >= weeklyResetAt) {
      weeklyPct = 0;
      weeklyResetAt = 0;
      weeklyResetProvisional = false;
    } else if (weeklyResetAt === 0) {
      weeklyResetProvisional = false;
    }

    return {
      detectedPlan: plan,
      planConfidence: plan ? conf : 'default',
      syncedAt: syncedAt,
      window5hPct: window5hPct,
      window5hResetAt: window5hResetAt,
      window5hResetProvisional: window5hResetProvisional,
      weeklyPct: weeklyPct,
      weeklyResetAt: weeklyResetAt,
      weeklyResetProvisional: weeklyResetProvisional
    };
  }

  function applyProvisionalReset(store, now) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const next = normalizeUsageStore(store, ts);
    if (next.window5hResetAt <= 0) {
      next.window5hResetAt = ts + WINDOW_5H_MS;
      next.window5hResetProvisional = true;
      if (next.window5hPct === null) next.window5hPct = 0;
    }
    if (next.weeklyResetAt <= 0) {
      next.weeklyResetAt = ts + WINDOW_WEEK_MS;
      next.weeklyResetProvisional = true;
      if (next.weeklyPct === null) next.weeklyPct = 0;
    }
    return next;
  }

  function mergeSyncedUsage(existing, incoming, now) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const ex = existing && typeof existing === 'object' ? existing : {};
    const inc = incoming && typeof incoming === 'object' ? incoming : {};
    const nextPlan = inc.detectedPlan || ex.detectedPlan || null;
    const nextConf = inc.detectedPlan ? 'high' : (ex.planConfidence || 'default');

    const scraped5hReset = Number(inc.window5hResetAt) || 0;
    const prev5hReset = Number(ex.window5hResetAt) || 0;
    let window5hResetAt = 0;
    let window5hResetProvisional = false;
    if (scraped5hReset > 0) {
      window5hResetAt = scraped5hReset;
      window5hResetProvisional = false;
    } else if (prev5hReset > ts && (ex.window5hResetProvisional || Number(inc.window5hPct) > 0)) {
      window5hResetAt = prev5hReset;
      window5hResetProvisional = !!ex.window5hResetProvisional;
    }

    const scrapedWeekReset = Number(inc.weeklyResetAt) || 0;
    const prevWeekReset = Number(ex.weeklyResetAt) || 0;
    let weeklyResetAt = 0;
    let weeklyResetProvisional = false;
    if (scrapedWeekReset > 0) {
      weeklyResetAt = scrapedWeekReset;
      weeklyResetProvisional = false;
    } else if (prevWeekReset > ts && (ex.weeklyResetProvisional || Number(inc.weeklyPct) > 0)) {
      weeklyResetAt = prevWeekReset;
      weeklyResetProvisional = !!ex.weeklyResetProvisional;
    }

    const pct5h = inc.window5hPct !== undefined && inc.window5hPct !== null
      ? inc.window5hPct
      : (ex.window5hPct !== undefined ? ex.window5hPct : null);
    const pctWeek = inc.weeklyPct !== undefined && inc.weeklyPct !== null
      ? inc.weeklyPct
      : (ex.weeklyPct !== undefined ? ex.weeklyPct : null);

    return normalizeUsageStore({
      detectedPlan: nextPlan,
      planConfidence: nextPlan ? nextConf : 'default',
      syncedAt: Number(inc.syncedAt) || ts,
      window5hPct: pct5h,
      window5hResetAt: window5hResetAt,
      window5hResetProvisional: window5hResetProvisional,
      weeklyPct: pctWeek,
      weeklyResetAt: weeklyResetAt,
      weeklyResetProvisional: weeklyResetProvisional
    }, ts);
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

  function formatSyncAge(ageMs) {
    const ms = Math.max(0, Number(ageMs) || 0);
    if (ms < 60000) return 'just now';
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
    if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago';
    return Math.floor(ms / 86400000) + 'd ago';
  }

  function formatResetClock(ts, includeDay) {
    if (!(ts > 0)) return '';
    try {
      const dt = new Date(ts);
      const clock = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (!includeDay) return clock;
      const day = dt.toLocaleDateString('en-US', { weekday: 'short' });
      return day ? day + ' ' + clock : clock;
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
    const hit5h = !!(ban && (ban.scope === 'daily' || ban.scope === 'both'));
    const hitWeek = !!(ban && (ban.scope === 'weekly' || ban.scope === 'both'));

    const has5h = (norm.syncedAt > 0 || norm.window5hResetProvisional) && norm.window5hPct !== null;
    const window5hPct = hit5h ? 100 : (has5h ? norm.window5hPct : null);
    const window5hResetAt = has5h && !hit5h ? norm.window5hResetAt : 0;
    const rem5hMs = window5hResetAt > now ? window5hResetAt - now : 0;
    const cd5hRaw = formatCountdown(rem5hMs);
    const is5hProv = !!(has5h && !hit5h && norm.window5hResetProvisional && cd5hRaw);
    const cd5h = cd5hRaw
      ? ((is5hProv ? '~' : '') + cd5hRaw)
      : (hit5h && ban.resetHint ? ban.resetHint : '');
    const level5h = window5hPct === null ? 'normal' : computeTierLevel(window5hPct / 100);
    const window5hText = window5hPct === null
      ? '5h ...'
      : '5h ' + window5hPct + '%' + (cd5h ? ' (' + cd5h + ')' : '');

    const hasWeek = (norm.syncedAt > 0 || norm.weeklyResetProvisional) && norm.weeklyPct !== null;
    const weeklyPct = hitWeek ? 100 : (hasWeek ? norm.weeklyPct : null);
    const weeklyResetAt = hasWeek && !hitWeek ? norm.weeklyResetAt : 0;
    const remWeekMs = weeklyResetAt > now ? weeklyResetAt - now : 0;
    const cdWeekRaw = formatCountdown(remWeekMs);
    const isWeekProv = !!(hasWeek && !hitWeek && norm.weeklyResetProvisional && cdWeekRaw);
    const cdWeek = cdWeekRaw
      ? ((isWeekProv ? '~' : '') + cdWeekRaw)
      : (hitWeek && ban.resetHint ? ban.resetHint : '');
    const levelWeek = weeklyPct === null ? 'normal' : computeTierLevel(weeklyPct / 100);
    const weeklyText = weeklyPct === null
      ? 'Week ...'
      : 'Week ' + weeklyPct + '%' + (cdWeek ? ' (' + cdWeek + ')' : '');

    const pctStr = ctxPct >= 100 ? Math.round(ctxPct) + '%' : ctxPct.toFixed(1) + '%';
    const ctxText = '~' + formatCompactTokens(totalTokens) + ' / ' + spec.capLabel + ' (' + pctStr + ')';

    const c5 = formatResetClock(window5hResetAt, false);
    const tip5h = window5hPct === null
      ? 'Syncing from /usage...'
      : window5hPct + '% used' + (cd5h ? ' \u00b7 resets in ' + cd5h : '') + (c5 ? ' (' + c5 + ')' : '') + (is5hProv ? ' (provisional)' : '');

    const cW = formatResetClock(weeklyResetAt, true);
    const tipWeekly = weeklyPct === null
      ? 'Syncing from /usage...'
      : weeklyPct + '% used' + (cdWeek ? ' \u00b7 resets in ' + cdWeek : '') + (cW ? ' (' + cW + ')' : '') + (isWeekProv ? ' (provisional)' : '');

    const footerText = norm.syncedAt > 0
      ? 'Synced from gemini.google.com/usage \u00b7 ' + formatSyncAge(Math.max(0, now - norm.syncedAt))
      : 'Syncing official usage from gemini.google.com/usage...';

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
      syncedAt: norm.syncedAt,
      window5hPct: window5hPct,
      window5hResetAt: window5hResetAt,
      window5hResetProvisional: norm.window5hResetProvisional,
      window5hLevel: level5h,
      window5hText: window5hText,
      dailyLevel: level5h,
      dailyText: window5hText,
      weeklyPct: weeklyPct,
      weeklyResetAt: weeklyResetAt,
      weeklyResetProvisional: norm.weeklyResetProvisional,
      weeklyLevel: levelWeek,
      weeklyText: weeklyText,
      tip5h: tip5h,
      tipWeekly: tipWeekly,
      planBadgeText: spec.label + ' \u00b7 ' + spec.capLabel,
      footerText: footerText
    };
  }

  // ---------- DOM adapter ----------
  const S = {
    doc: null,
    enabled: true,
    mounted: false,
    isAutoSyncTab: false,
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
    syncSettleTimer: 0,
    syncIdleTimer: 0,
    syncCapTimer: 0,
    syncIdleUnsub: null,
    manualSyncTimer: 0,
    isManualSyncing: false,
    scrapeTimer: 0,
    scrapeStartAt: 0,
    first5hAt: 0,
    storageListener: null,
    draftEl: null,
    draftTimer: 0,
    saveTimer: 0,
    dirtyStore: false,
    lastBarPos: '',
    lastFillTransform: '',
    turnCache: new WeakMap(),
    store: normalizeUsageStore(null, Date.now()),
    storeLoaded: false,
    fromHomeSubmit: false,
    lastDraftTokens: 0,
    sawUserInputSinceRoute: false,
    routeHydrateUntil: 0,
    lastResponseSig: { path: '', lastTurnEl: null, lastTurnOut: 0 },
    lastUpdateArgs: { turns: [], streaming: false, wasStreaming: false, url: '' }
  };

  function Sel() { return root.GeminiOptSelectors; }

  function storageArea() {
    return root.chrome && root.chrome.storage ? root.chrome.storage.local : null;
  }

  function pathnameOf(locOrUrl) {
    if (locOrUrl && typeof locOrUrl === 'object' && typeof locOrUrl.pathname === 'string') {
      return locOrUrl.pathname.replace(/\/+$/, '') || '/';
    }
    if (typeof locOrUrl === 'string' && locOrUrl) {
      try { return (new URL(locOrUrl, 'https://gemini.google.com').pathname || '/').replace(/\/+$/, '') || '/'; }
      catch (_) { return locOrUrl.replace(/\/+$/, '') || '/'; }
    }
    if (root.location && typeof root.location.pathname === 'string') {
      return root.location.pathname.replace(/\/+$/, '') || '/';
    }
    return '/';
  }

  function isUsagePath(locOrUrl) {
    return /^\/usage\b/i.test(pathnameOf(locOrUrl));
  }

  let scrollStateFn = null;
  let scrollIdleSubscribeFn = null;

  function setScrollStateProvider(isScrollingFn, onIdleSubscribeFn) {
    if (isScrollingFn && typeof isScrollingFn === 'object') {
      scrollStateFn = typeof isScrollingFn.isScrolling === 'function' ? isScrollingFn.isScrolling : null;
      scrollIdleSubscribeFn = typeof isScrollingFn.onIdle === 'function' ? isScrollingFn.onIdle : null;
      return;
    }
    scrollStateFn = typeof isScrollingFn === 'function' ? isScrollingFn : null;
    scrollIdleSubscribeFn = typeof onIdleSubscribeFn === 'function' ? onIdleSubscribeFn : null;
  }

  function isScrollingNow() {
    if (!scrollStateFn) return false;
    try {
      const v = scrollStateFn();
      return !!(v && typeof v === 'object' ? v.scrolling : v);
    } catch (_) {
      return false;
    }
  }

  function clearPostAnswerSyncTimers() {
    root.clearTimeout(S.syncSettleTimer); S.syncSettleTimer = 0;
    root.clearTimeout(S.syncIdleTimer); S.syncIdleTimer = 0;
    root.clearTimeout(S.syncCapTimer); S.syncCapTimer = 0;
    if (typeof S.syncIdleUnsub === 'function') {
      try { S.syncIdleUnsub(); } catch (_) { /* ignore */ }
    }
    S.syncIdleUnsub = null;
  }

  function flushPostAnswerSync() {
    clearPostAnswerSyncTimers();
    flushPersist();
    requestUsageSync('response');
  }

  function schedulePostAnswerSync() {
    if (!S.enabled || isUsagePath(root.location)) return;
    clearPostAnswerSyncTimers();
    S.syncSettleTimer = root.setTimeout(function () {
      S.syncSettleTimer = 0;
      if (!S.enabled || isUsagePath(root.location)) return;
      if (!isScrollingNow()) {
        flushPersist();
        requestUsageSync('response');
        return;
      }
      S.syncCapTimer = root.setTimeout(flushPostAnswerSync, SYNC_MAX_DEFER_MS);
      const waitIdleThenSync = function () {
        S.syncIdleUnsub = null;
        if (!S.enabled || isUsagePath(root.location)) {
          clearPostAnswerSyncTimers();
          return;
        }
        if (isScrollingNow()) {
          if (scrollIdleSubscribeFn) S.syncIdleUnsub = scrollIdleSubscribeFn(waitIdleThenSync);
          else S.syncIdleTimer = root.setTimeout(waitIdleThenSync, 120);
          return;
        }
        root.clearTimeout(S.syncIdleTimer);
        S.syncIdleTimer = root.setTimeout(function () {
          S.syncIdleTimer = 0;
          if (!S.enabled || isUsagePath(root.location)) {
            clearPostAnswerSyncTimers();
            return;
          }
          if (isScrollingNow()) {
            waitIdleThenSync();
            return;
          }
          flushPostAnswerSync();
        }, SYNC_IDLE_DEFER_MS);
      };
      if (scrollIdleSubscribeFn) {
        S.syncIdleUnsub = scrollIdleSubscribeFn(waitIdleThenSync);
      } else {
        S.syncIdleTimer = root.setTimeout(waitIdleThenSync, 120);
      }
    }, SYNC_SETTLE_MS);
  }

  function setManualSyncing(on) {
    S.isManualSyncing = !!on;
    root.clearTimeout(S.manualSyncTimer);
    S.manualSyncTimer = 0;
    if (S.bar && S.bar.classList) {
      S.bar.classList.toggle('is-syncing', S.isManualSyncing);
    }
    if (S.isManualSyncing) {
      if (S.tipFooter) S.tipFooter.textContent = 'Syncing official usage...';
      S.manualSyncTimer = root.setTimeout(function () {
        setManualSyncing(false);
        if (S.mounted && S.visible && !isUsagePath(root.location)) {
          update(S.lastUpdateArgs);
        }
      }, MANUAL_SYNC_TIMEOUT_MS);
    }
  }

  function requestManualSync() {
    if (!S.enabled || isUsagePath(root.location)) return;
    setManualSyncing(true);
    flushPersist();
    requestUsageSync('manual');
  }

  function requestUsageSync(reason) {
    if (!S.enabled || isUsagePath(root.location)) return;
    if (!root.chrome || !root.chrome.runtime || typeof root.chrome.runtime.sendMessage !== 'function') return;
    try {
      root.chrome.runtime.sendMessage({ type: 'TRIGGER_USAGE_SYNC', reason: reason || 'chat' }, function () {
        void (root.chrome && root.chrome.runtime && root.chrome.runtime.lastError);
      });
    } catch (_) { /* ignore */ }
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
        const nowTs = Date.now();
        const loaded = normalizeUsageStore(res && res[STORAGE_KEY], nowTs);
        if (S.store && S.store.planConfidence === 'high' && S.store.detectedPlan && !loaded.detectedPlan) {
          loaded.detectedPlan = S.store.detectedPlan;
          loaded.planConfidence = 'high';
        }
        if (S.store && S.store.window5hResetProvisional && S.store.window5hResetAt > nowTs && loaded.window5hResetAt <= 0) {
          loaded.window5hResetAt = S.store.window5hResetAt;
          loaded.window5hResetProvisional = true;
          if (loaded.window5hPct === null) loaded.window5hPct = 0;
        }
        if (S.store && S.store.weeklyResetProvisional && S.store.weeklyResetAt > nowTs && loaded.weeklyResetAt <= 0) {
          loaded.weeklyResetAt = S.store.weeklyResetAt;
          loaded.weeklyResetProvisional = true;
          if (loaded.weeklyPct === null) loaded.weeklyPct = 0;
        }
        S.store = normalizeUsageStore(loaded, nowTs);
        S.storeLoaded = true;
        if (S.mounted && !isUsagePath(root.location)) {
          if (S.store.syncedAt === 0 && S.enabled) requestUsageSync('initial');
          if (S.lastUpdateArgs.url || S.lastUpdateArgs.turns.length > 0) update(S.lastUpdateArgs);
        }
      });
    } catch (_) {
      S.storeLoaded = true;
    }
  }

  function writeStoreNow() {
    S.dirtyStore = false;
    const area = storageArea();
    if (!area || typeof area.set !== 'function') return;
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
    S.saveTimer = root.setTimeout(function () {
      S.saveTimer = 0;
      if (S.dirtyStore) writeStoreNow();
    }, 350);
  }

  function flushPersist() {
    root.clearTimeout(S.saveTimer);
    S.saveTimer = 0;
    if (S.dirtyStore) writeStoreNow();
  }

  const EXCLUDED_USAGE_NAV_SEL = 'bard-sidenav, side-navigation-v2, mat-sidenav, nav[role="navigation"], [data-gopt-owned], script, style';
  const USAGE_BLOCK_RE = /^(div|p|section|article|li|h[1-6]|tr|mat-card|header|footer|aside)$/i;

  function collectLines(node, buf) {
    if (!node) return;
    if (node.nodeType === 3) {
      const t = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (t) buf.push(t + ' ');
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.matches && node.matches(EXCLUDED_USAGE_NAV_SEL)) return;
    if (node.tagName === 'BR') { buf.push('\n'); return; }
    const tag = String(node.tagName || '');
    const isBlock = USAGE_BLOCK_RE.test(tag) || tag.indexOf('-') >= 0;
    if (isBlock) buf.push('\n');
    const kids = node.childNodes || [];
    for (let i = 0; i < kids.length; i++) collectLines(kids[i], buf);
    if (isBlock) buf.push('\n');
  }

  function extractUsageContainerText(doc) {
    if (!doc || !doc.querySelector) return '';
    const container =
      doc.querySelector('bard-sidenav-content') ||
      doc.querySelector('.usage-container') ||
      doc.querySelector('.content-container') ||
      doc.body;
    if (!container) return '';
    if (!container.childNodes || !container.childNodes.length) {
      return container.textContent || '';
    }
    const buf = [];
    collectLines(container, buf);
    return buf.join('').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{2,}/g, '\n');
  }

  function stopScraper() {
    if (S.scrapeTimer) {
      root.clearTimeout(S.scrapeTimer);
      S.scrapeTimer = 0;
    }
    S.scrapeStartAt = 0;
    S.first5hAt = 0;
  }

  function finishScrape(parsed, isAutoSync) {
    stopScraper();
    const area = storageArea();
    const sendResult = function () {
      if (!root.chrome || !root.chrome.runtime || typeof root.chrome.runtime.sendMessage !== 'function') return;
      try {
        root.chrome.runtime.sendMessage({
          type: 'USAGE_SYNC_RESULT',
          data: parsed,
          isAutoSync: !!isAutoSync
        }, function () {
          void (root.chrome && root.chrome.runtime && root.chrome.runtime.lastError);
        });
      } catch (_) { /* ignore */ }
    };
    const merged = mergeSyncedUsage(S.store, parsed, Date.now());
    S.store = merged;
    if (area && typeof area.get === 'function' && typeof area.set === 'function') {
      try {
        area.get(STORAGE_KEY, function (res) {
          const cur = res && res[STORAGE_KEY] ? res[STORAGE_KEY] : {};
          const next = mergeSyncedUsage(cur, parsed, Date.now());
          S.store = next;
          const obj = {};
          obj[STORAGE_KEY] = next;
          area.set(obj, function () { sendResult(); });
        });
        return;
      } catch (_) { /* fall through */ }
    }
    sendResult();
  }

  function abortScrape(isAutoSync) {
    stopScraper();
    if (!isAutoSync) return;
    if (!root.chrome || !root.chrome.runtime || typeof root.chrome.runtime.sendMessage !== 'function') return;
    try {
      root.chrome.runtime.sendMessage({ type: 'USAGE_SYNC_ABORT', isAutoSync: true }, function () {
        void (root.chrome && root.chrome.runtime && root.chrome.runtime.lastError);
      });
    } catch (_) { /* ignore */ }
  }

  function runUsagePageScraper(doc, isAutoSync) {
    stopScraper();
    const targetDoc = doc || S.doc || root.document;
    if (!targetDoc) return;
    S.scrapeStartAt = Date.now();
    S.first5hAt = 0;

    const tick = function () {
      S.scrapeTimer = 0;
      if (!S.mounted || !isUsagePath(root.location)) return;
      const now = Date.now();
      const text = extractUsageContainerText(targetDoc);
      const parsed = text ? parseUsagePageText(text, now) : null;
      if (parsed && parsed.window5hPct !== null) {
        if (parsed.weeklyPct !== null) {
          finishScrape(parsed, isAutoSync);
          return;
        }
        if (!S.first5hAt) S.first5hAt = now;
        if (now - S.first5hAt >= SCRAPE_WEEKLY_GRACE_MS) {
          finishScrape(parsed, isAutoSync);
          return;
        }
      }
      if (now - S.scrapeStartAt >= SCRAPE_MAX_MS) {
        if (parsed && parsed.window5hPct !== null) finishScrape(parsed, isAutoSync);
        else abortScrape(isAutoSync);
        return;
      }
      if (typeof root.setTimeout === 'function') {
        S.scrapeTimer = root.setTimeout(tick, SCRAPE_POLL_MS);
      }
    };
    tick();
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
    bar.setAttribute('role', 'button');
    bar.setAttribute('aria-label', 'Token and usage tracker. Activate to sync official usage');
    bar.setAttribute('aria-describedby', 'gopt-token-tooltip');

    const meter = el('span', 'gopt-tk-meter');
    meter.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'gopt-tk-fill');
    meter.appendChild(fill);

    const ctxEl = el('span', 'gopt-tk-ctx', '~0 / 32k (0.0%)');
    const sep1 = el('span', 'gopt-tk-sep', '\u00b7');
    sep1.setAttribute('aria-hidden', 'true');
    const dayEl = el('span', 'gopt-tk-day', '5h ...');
    const sep2 = el('span', 'gopt-tk-sep', '\u00b7');
    sep2.setAttribute('aria-hidden', 'true');
    const weekEl = el('span', 'gopt-tk-week', 'Week ...');

    bar.appendChild(ctxEl);
    bar.appendChild(sep1);
    bar.appendChild(dayEl);
    bar.appendChild(sep2);
    bar.appendChild(weekEl);
    bar.appendChild(meter);

    const tip = el('div', 'gopt-tooltip gopt-token-tooltip');
    tip.id = 'gopt-token-tooltip';
    tip.setAttribute('data-gopt-owned', '');
    tip.setAttribute('role', 'tooltip');

    const head = el('div', 'gopt-tooltip-head');
    head.appendChild(el('span', 'gopt-tooltip-index', 'Context & Usage'));
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
    const rDaily = makeRow('5-Hour');
    const rWeekly = makeRow('Weekly');
    qGrid.appendChild(rDaily.row);
    qGrid.appendChild(rWeekly.row);
    tip.appendChild(qGrid);

    const tipFooter = el('div', 'gopt-tk-footer', 'Syncing official usage from gemini.google.com/usage...');
    tip.appendChild(tipFooter);

    bar.addEventListener('pointerenter', function (ev) {
      if (ev.pointerType === 'touch') return;
      scheduleTipShow(80);
    });
    bar.addEventListener('pointerleave', hideTip);
    bar.addEventListener('focus', function () { scheduleTipShow(0); });
    bar.addEventListener('blur', hideTip);
    bar.addEventListener('click', function () {
      const doc = S.doc;
      const win = doc && doc.defaultView ? doc.defaultView : root;
      const sel = win && typeof win.getSelection === 'function' ? win.getSelection() : null;
      if (sel && String(sel).trim().length > 0) return;
      requestManualSync();
    });
    bar.addEventListener('keydown', function (ev) {
      if (!ev) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        requestManualSync();
      }
    });

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
    if (delayMs <= 0) showTip();
    else S.tipTimer = root.setTimeout(showTip, delayMs);
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
    if (!Svc || !doc) return { planRes: resolvePlan({ storedPlan: S.store.detectedPlan }), limitBanner: null };

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
    const models = Svc.queryAll(doc, Svc.SEL.modelSelector);
    for (const m of models) {
      if (!Svc.isVisible(m)) continue;
      const t = (m.textContent || (m.getAttribute && m.getAttribute('aria-label')) || '').trim();
      if (!t) continue;
      modelPlan = classifyModelTierText(t);
      if (modelPlan) break;
    }

    // Do not allow an "Upgrade" upsell CTA on chat page to downgrade an official synced paid plan.
    const officialPaid = S.store.syncedAt > 0 && S.store.planConfidence === 'high' &&
      S.store.detectedPlan && S.store.detectedPlan !== 'free';
    const effectiveBadge = (officialPaid && badgePlan === 'free') ? null : badgePlan;

    const planRes = resolvePlan({
      badgePlan: effectiveBadge,
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

    return { planRes: planRes, limitBanner: limitBanner };
  }

  function measureTurns(turns, streaming) {
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
      const isLast = i === turns.length - 1;
      const canSettle = !isLast && !streaming;
      const mr = Svc.queryFirst(turn, Svc.SEL.modelResponse);
      const childCount = mr && typeof mr.childElementCount === 'number' ? mr.childElementCount : -1;
      const cached = S.turnCache.get(turn);
      if (cached && cached.settled && canSettle && cached.childCount === childCount) {
        inputTokens += cached.inTok;
        outputTokens += cached.outTok;
        if (cached.media) hasMedia = true;
        continue;
      }

      const uq = Svc.queryFirst(turn, Svc.SEL.userQuery);
      const uText = uq ? (uq.textContent || '') : '';
      const mText = mr ? (mr.textContent || '') : '';
      const uLen = uText.length;
      const mLen = mText.length;
      if (cached && cached.uLen === uLen && cached.mLen === mLen) {
        if (canSettle && !cached.settled && mLen > 0) {
          cached.settled = true;
          cached.childCount = childCount;
        }
        inputTokens += cached.inTok;
        outputTokens += cached.outTok;
        if (cached.media) hasMedia = true;
        continue;
      }

      let mEffectiveText = mText;
      if (mr && typeof mr.querySelectorAll === 'function' && mLen > 0) {
        let mathNodes = [];
        try { mathNodes = mr.querySelectorAll('.katex-mathml'); } catch (_) { mathNodes = []; }
        if (mathNodes && mathNodes.length > 0) {
          const chunks = [];
          for (let k = 0; k < mathNodes.length; k++) {
            const mt = mathNodes[k].textContent || '';
            if (mt) chunks.push(mt);
          }
          const mathJoinedLen = chunks.join('').length;
          if (mathJoinedLen > 0 && mathJoinedLen < mLen) {
            mEffectiveText = mText.slice(0, Math.max(1, mLen - Math.floor(mathJoinedLen * 0.65)));
          }
        }
      }

      const inTok = uLen > 0 ? estimateTokens(uText) : 0;
      const outTok = mLen > 0 ? estimateTokens(mEffectiveText) : 0;
      const media = !!(turn.querySelector && turn.querySelector('img:not([data-gopt-owned] *), video, canvas, [class*="attachment"]'));
      S.turnCache.set(turn, {
        uLen: uLen,
        mLen: mLen,
        childCount: childCount,
        settled: canSettle && mLen > 0,
        inTok: inTok,
        outTok: outTok,
        media: media
      });
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
    S.sawUserInputSinceRoute = true;
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
    const box = anchor && anchor.querySelector
      ? (anchor.querySelector('.text-input-field') || anchor.querySelector('rich-textarea') || anchor)
      : anchor;
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
    S.dayEl.setAttribute('data-level', snap.window5hLevel);
    S.weekEl.setAttribute('data-level', snap.weeklyLevel);

    if (S.ctxEl.textContent !== snap.ctxText) S.ctxEl.textContent = snap.ctxText;
    if (S.dayEl.textContent !== snap.window5hText) S.dayEl.textContent = snap.window5hText;
    if (S.weekEl.textContent !== snap.weeklyText) S.weekEl.textContent = snap.weeklyText;

    if (S.tipBadge.textContent !== snap.planBadgeText) S.tipBadge.textContent = snap.planBadgeText;
    S.tipIn.textContent = '~' + formatCompactTokens(snap.inputTokens) + ' tokens';
    S.tipOut.textContent = '~' + formatCompactTokens(snap.outputTokens) + ' tokens';
    S.tipDraft.textContent = '~' + formatCompactTokens(snap.draftTokens) + ' tokens';
    S.tipMedia.hidden = !snap.hasMedia;
    const fullCap = snap.plan.contextCap >= 1000000 ? '1,000,000' : snap.plan.contextCap.toLocaleString('en-US');
    const pctStr = snap.ctxRatio * 100 >= 100 ? Math.round(snap.ctxRatio * 100) + '%' : (snap.ctxRatio * 100).toFixed(1) + '%';
    S.tipTotal.textContent = '~' + formatCompactTokens(snap.totalTokens) + ' / ' + fullCap + ' (' + pctStr + ')';

    S.tipDaily.textContent = snap.tip5h;
    S.tipWeekly.textContent = snap.tipWeekly;
    const nextFooter = S.isManualSyncing ? 'Syncing official usage...' : snap.footerText;
    if (S.tipFooter.textContent !== nextFooter) S.tipFooter.textContent = nextFooter;
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

  function attachStorageListener() {
    const api = root.chrome && root.chrome.storage;
    if (!api || !api.onChanged || typeof api.onChanged.addListener !== 'function' || S.storageListener) return;
    S.storageListener = function (changes, areaName) {
      if (areaName !== 'local' || !changes || !(STORAGE_KEY in changes)) return;
      S.store = normalizeUsageStore(changes[STORAGE_KEY].newValue, Date.now());
      S.storeLoaded = true;
      setManualSyncing(false);
      if (S.mounted && !isUsagePath(root.location)) update(S.lastUpdateArgs);
    };
    api.onChanged.addListener(S.storageListener);
  }

  function detachStorageListener() {
    const api = root.chrome && root.chrome.storage;
    if (S.storageListener && api && api.onChanged && typeof api.onChanged.removeListener === 'function') {
      api.onChanged.removeListener(S.storageListener);
    }
    S.storageListener = null;
  }

  function mount(doc) {
    S.doc = doc || root.document;
    if (!S.doc || S.mounted) return;
    S.mounted = true;
    S.routeHydrateUntil = Date.now() + 1800;
    S.sawUserInputSinceRoute = false;
    S.fromHomeSubmit = false;
    S.isAutoSyncTab = !!(root.location && root.location.hash === '#gopt-sync');
    attachStorageListener();

    if (isUsagePath(root.location)) {
      runUsagePageScraper(S.doc, S.isAutoSyncTab);
      return;
    }

    loadUsageStore();
    ensureDom();
    attachObservers();
    if (root.addEventListener) root.addEventListener('resize', schedulePlace, { passive: true });
  }

  function setEnabled(on) {
    S.enabled = !!on;
    if (!S.enabled) {
      clearPostAnswerSyncTimers();
      setManualSyncing(false);
      setVisible(false);
    } else if (S.mounted && !isUsagePath(root.location)) {
      if (S.storeLoaded && S.store.syncedAt === 0) requestUsageSync('initial');
      update(S.lastUpdateArgs);
    }
  }

  function update(opts) {
    if (!S.mounted || !S.doc) return;
    const o = opts || S.lastUpdateArgs || {};
    const curUrl = o.url !== undefined ? o.url : (root.location ? root.location.href : '');
    if (isUsagePath(curUrl) || isUsagePath(root.location)) {
      setVisible(false);
      return;
    }

    const edgeFinished = !!o.wasStreaming && !o.streaming;
    S.lastUpdateArgs = {
      turns: Array.isArray(o.turns) ? o.turns : [],
      streaming: !!o.streaming,
      wasStreaming: false,
      url: curUrl,
      doc: o.doc || S.doc
    };

    const turns = S.lastUpdateArgs.turns;
    const doc = S.lastUpdateArgs.doc;
    const draft = readDraftInfo(doc);
    if (draft.draftTokens > 0) S.sawUserInputSinceRoute = true;
    S.lastDraftTokens = draft.draftTokens;

    if (!S.enabled) {
      setVisible(false);
      return;
    }

    const measured = measureTurns(turns, S.lastUpdateArgs.streaming);
    const curPath = pathnameOf(curUrl);
    const lastTurnEl = turns.length ? turns[turns.length - 1] : null;
    const lastCached = lastTurnEl ? S.turnCache.get(lastTurnEl) : null;
    const lastTurnOut = lastCached ? lastCached.outTok : 0;

    if (S.lastUpdateArgs.streaming) {
      clearPostAnswerSyncTimers();
      if (S.lastResponseSig.path !== curPath) {
        S.lastResponseSig = { path: curPath, lastTurnEl: null, lastTurnOut: 0 };
      }
    } else {
      let responseCompleted = edgeFinished;
      const hydrating = Date.now() < S.routeHydrateUntil && !S.sawUserInputSinceRoute;
      if (S.lastResponseSig.path !== curPath) {
        if (turns.length === 0) {
          S.lastResponseSig = { path: curPath, lastTurnEl: null, lastTurnOut: 0 };
        } else {
          if (S.fromHomeSubmit && turns.length === 1 && lastTurnOut > 0) responseCompleted = true;
          S.fromHomeSubmit = false;
          S.lastResponseSig = { path: curPath, lastTurnEl: lastTurnEl, lastTurnOut: lastTurnOut };
        }
      } else if (lastTurnEl) {
        if (S.lastResponseSig.lastTurnEl === null) {
          // Initial hydration of an existing conversation after empty loading state must NOT trigger /usage sync.
          if (S.fromHomeSubmit && turns.length === 1 && lastTurnOut > 0) responseCompleted = true;
          S.fromHomeSubmit = false;
          S.lastResponseSig = { path: curPath, lastTurnEl: lastTurnEl, lastTurnOut: lastTurnOut };
        } else {
          const isNewLastTurn = lastTurnEl !== S.lastResponseSig.lastTurnEl;
          const grewOutput = (S.lastResponseSig.lastTurnOut === 0 && lastTurnOut > 0) ||
            (lastTurnOut > S.lastResponseSig.lastTurnOut + 10);
          if (lastTurnOut > 0 && ((isNewLastTurn && !hydrating) || (!isNewLastTurn && grewOutput))) {
            responseCompleted = true;
          }
          if (isNewLastTurn || lastTurnOut > S.lastResponseSig.lastTurnOut) {
            S.lastResponseSig = { path: curPath, lastTurnEl: lastTurnEl, lastTurnOut: lastTurnOut };
          }
          S.fromHomeSubmit = false;
        }
      }
      if (responseCompleted) {
        const nowTs = Date.now();
        const prev5h = S.store.window5hResetAt;
        const prevWeek = S.store.weeklyResetAt;
        if (prev5h <= 0 || prevWeek <= 0) {
          S.store = applyProvisionalReset(S.store, nowTs);
          if (S.store.window5hResetAt !== prev5h || S.store.weeklyResetAt !== prevWeek) {
            schedulePersist();
          }
        }
        schedulePostAnswerSync();
      }
    }

    const signals = scanDomSignals(doc);
    const persistablePlan = (signals.planRes.confidence === 'high' || signals.planRes.confidence === 'model')
      ? signals.planRes.plan : null;
    const persistableConf = persistablePlan ? signals.planRes.confidence : null;
    const shouldPersistPlan = !!persistablePlan &&
      S.store.detectedPlan !== persistablePlan &&
      !(S.store.syncedAt > 0 && S.store.planConfidence === 'high' && persistableConf !== 'high');

    if (shouldPersistPlan) {
      S.store.detectedPlan = persistablePlan;
      S.store.planConfidence = persistableConf;
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
      now: Date.now()
    });
    renderSnapshot(snap);
    attachObservers();
    setVisible(true);
  }

  function startSmoothTrack(durationMs) {
    if (!S.mounted || isUsagePath(root.location)) return;
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
    clearPostAnswerSyncTimers();
    setManualSyncing(false);
    stopScraper();
    const prevPath = S.lastResponseSig.path || pathnameOf(S.lastUpdateArgs && S.lastUpdateArgs.url);
    const isHomePath = prevPath === '/app' || prevPath === '/' || /^\/u\/\d+\/app$/i.test(prevPath);
    S.fromHomeSubmit = isHomePath && (S.lastDraftTokens > 0 || S.sawUserInputSinceRoute) && !isUsagePath(root.location);
    S.lastDraftTokens = 0;
    S.sawUserInputSinceRoute = false;
    S.routeHydrateUntil = Date.now() + 1800;
    S.lastResponseSig = { path: '', lastTurnEl: null, lastTurnOut: 0 };
    S.lastBarPos = '';
    S.lastUpdateArgs = { turns: [], streaming: false, wasStreaming: false, url: root.location ? root.location.href : '', doc: S.doc };
    if (S.draftEl) {
      S.draftEl.removeEventListener('input', onDraftInput);
      S.draftEl = null;
    }
    setVisible(false);
    if (S.mounted && isUsagePath(root.location)) {
      S.isAutoSyncTab = !!(root.location && root.location.hash === '#gopt-sync');
      runUsagePageScraper(S.doc, S.isAutoSyncTab);
    }
  }

  function destroy() {
    S.mounted = false;
    flushPersist();
    stopScraper();
    detachStorageListener();
    setVisible(false);
    clearPostAnswerSyncTimers();
    setManualSyncing(false);
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
    S.fromHomeSubmit = false;
    S.lastDraftTokens = 0;
    S.sawUserInputSinceRoute = false;
    S.routeHydrateUntil = 0;
    S.lastResponseSig = { path: '', lastTurnEl: null, lastTurnOut: 0 };
    S.store = normalizeUsageStore(null, Date.now());
    S.storeLoaded = false;
    scrollStateFn = null;
    scrollIdleSubscribeFn = null;
  }

  return Object.freeze({
    STORAGE_KEY, PLAN_SPECS, WINDOW_5H_MS, WINDOW_WEEK_MS,
    estimateTokens, classifyPlanText, classifyModelTierText, resolvePlan,
    parseResetTimestamp, parseUsagePageText, formatSyncAge,
    normalizeUsageStore, applyProvisionalReset, computeQuotaSnapshot,
    formatCompactTokens, formatCountdown, computeTierLevel, detectLimitBannerText,
    setScrollStateProvider, mount, setEnabled, update, startSmoothTrack, resetRoute, destroy
  });
});
