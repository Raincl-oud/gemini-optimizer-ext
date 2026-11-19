// Gemini Web Optimizer - unit checks. Run: node tests/unit-checks.mjs  (prints PASS n checks, exit 1 on failure)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => path.join(ROOT, ...s);
const read = (...s) => fs.readFileSync(p(...s), 'utf8');

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, ext, out);
    else if (f.endsWith(ext)) out.push(f);
  }
  return out;
}

const Settings = require('../src/shared/settings.js');
const Selectors = require('../src/shared/selectors.js');
const Collapse = require('../src/content/collapse-manager.js');
const Nav = require('../src/content/strip-navigator.js');
const Early = require('../src/content/early-boot.js');

// ---------- settings ----------
check('settings: contentWidth defaults, fullWidth & DEFAULT_TYPOGRAPHY_RESET', () => {
  assert.equal(Settings.CONTENT_WIDTH_MIN, 60);
  assert.equal(Settings.CONTENT_WIDTH_MAX, 100);
  assert.deepEqual(Settings.DEFAULT_TYPOGRAPHY_RESET, {
    fontFamily: 'default', fontSize: null, lineHeight: null, paragraphGap: null, letterSpacing: null
  });
  assert.ok(!('fullWidth' in Settings.DEFAULT_TYPOGRAPHY_RESET));
  assert.ok(!('contentWidth' in Settings.DEFAULT_TYPOGRAPHY_RESET));
  assert.deepEqual(Settings.DEFAULT_TEXT_OPT, {
    fullWidth: true, contentWidth: 100, fontFamily: 'default', fontSize: null, lineHeight: null, paragraphGap: null, letterSpacing: null
  });
  assert.deepEqual(Settings.DEFAULT_SETTINGS, {
    autoCollapse: true, openPastChats: 4, hideSources: true, textOpt: Settings.DEFAULT_TEXT_OPT
  });
  assert.equal(Settings.resolveLightRenderActive, undefined);
  assert.equal(Settings.OPEN_TURN_LIMITS, undefined);
});
check('settings: openPastChats bounds (0..999) and legacy openTurnLimit migration', () => {
  assert.equal(Settings.normalizeSettings({ openPastChats: 0 }).openPastChats, 0);
  assert.equal(Settings.normalizeSettings({ openPastChats: '12' }).openPastChats, 12);
  assert.equal(Settings.normalizeSettings({ openPastChats: 999 }).openPastChats, 999);
  assert.equal(Settings.normalizeSettings({ openPastChats: 1500 }).openPastChats, 999);
  assert.equal(Settings.normalizeSettings({ openPastChats: -5 }).openPastChats, 0);
  assert.equal(Settings.normalizeSettings({ openPastChats: -0.5 }).openPastChats, 0);
  assert.equal(Settings.normalizeSettings({ openPastChats: NaN }).openPastChats, 4);
  assert.equal(Settings.normalizeSettings({ openPastChats: '' }).openPastChats, 4);
  assert.equal(Settings.normalizeSettings({ openPastChats: true }).openPastChats, 4);
  assert.equal(Settings.normalizeSettings({ openTurnLimit: 8 }).openPastChats, 8);
  assert.equal(Settings.normalizeSettings({ openPastChats: 0, openTurnLimit: 8 }).openPastChats, 0);
});
check('settings: normalizeSettings returns unfrozen fresh clones', () => {
  assert.deepEqual(Settings.normalizeSettings(null), Settings.DEFAULT_SETTINGS);
  assert.deepEqual(Settings.normalizeSettings('str'), Settings.DEFAULT_SETTINGS);
  const n = Settings.normalizeSettings({ hideSources: 'yes', junk: 1 });
  assert.equal(n.hideSources, true);
  assert.ok(!('junk' in n));
  assert.equal(Object.isFrozen(n), false);
  assert.equal(Object.isFrozen(n.textOpt), false);
  n.textOpt.fontSize = 20;
  assert.equal(Settings.DEFAULT_TEXT_OPT.fontSize, null);
});
check('settings: normalizeTextOpt validates fullWidth, contentWidth (60..100) & independent typography fields', () => {
  assert.deepEqual(Settings.normalizeTextOpt(null), Settings.DEFAULT_TEXT_OPT);
  assert.deepEqual(Settings.normalizeTextOpt([]), Settings.DEFAULT_TEXT_OPT);
  const t = Settings.normalizeTextOpt({
    fullWidth: false, contentWidth: 75.6, fontFamily: 'mono', fontSize: 5, lineHeight: 1.556, paragraphGap: 99, letterSpacing: -1
  });
  assert.deepEqual(t, {
    fullWidth: false, contentWidth: 76, fontFamily: 'mono', fontSize: 13, lineHeight: 1.56, paragraphGap: 28, letterSpacing: -0.03
  });
  const t2 = Settings.normalizeTextOpt({
    fullWidth: 'no', contentWidth: 'bad', fontFamily: 'comic', fontSize: '', lineHeight: null, paragraphGap: 'bad', letterSpacing: 0.5
  });
  assert.deepEqual(t2, {
    fullWidth: true, contentWidth: 100, fontFamily: 'default', fontSize: null, lineHeight: null, paragraphGap: null, letterSpacing: 0.08
  });
  assert.equal(Settings.normalizeTextOpt({ contentWidth: 20 }).contentWidth, 60);
  assert.equal(Settings.normalizeTextOpt({ contentWidth: 0 }).contentWidth, 60);
  assert.equal(Settings.normalizeTextOpt({ contentWidth: 140 }).contentWidth, 100);
  assert.equal(Settings.normalizeTextOpt({ contentWidth: '' }).contentWidth, 100);
});
function fakeArea(initial = {}) {
  const store = { ...initial };
  return {
    store,
    get: async (key) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj) => { Object.assign(store, obj); }
  };
}
await checkAsync('settings: load defaults from empty area', async () => {
  assert.deepEqual(await Settings.loadSettings(fakeArea()), Settings.DEFAULT_SETTINGS);
});
await checkAsync('settings: save merges partial textOpt and DEFAULT_TYPOGRAPHY_RESET preserves fullWidth & contentWidth', async () => {
  const area = fakeArea();
  await Settings.saveSettings({ openPastChats: 12, textOpt: { fullWidth: false, contentWidth: 82, fontSize: 18 } }, area);
  const next = await Settings.saveSettings({ textOpt: { fontFamily: 'serif', lineHeight: 1.75 } }, area);
  assert.equal(next.openPastChats, 12);
  assert.deepEqual(next.textOpt, {
    fullWidth: false, contentWidth: 82, fontFamily: 'serif', fontSize: 18, lineHeight: 1.75, paragraphGap: null, letterSpacing: null
  });
  const afterReset = await Settings.saveSettings({ textOpt: Settings.DEFAULT_TYPOGRAPHY_RESET }, area);
  assert.deepEqual(afterReset.textOpt, {
    fullWidth: false, contentWidth: 82, fontFamily: 'default', fontSize: null, lineHeight: null, paragraphGap: null, letterSpacing: null
  });
  assert.deepEqual(area.store[Settings.STORAGE_KEY], afterReset);
  assert.deepEqual(await Settings.loadSettings(area), afterReset);
});
await checkAsync('settings: concurrent saveSettings calls are serialized without losing either patch', async () => {
  const store = {};
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const slowArea = {
    async get(key) {
      await delay(10);
      return { [key]: store[key] ? structuredClone(store[key]) : undefined };
    },
    async set(obj) {
      await delay(10);
      Object.assign(store, structuredClone(obj));
    }
  };
  const [r1, r2] = await Promise.all([
    Settings.saveSettings({ openPastChats: 10 }, slowArea),
    Settings.saveSettings({ textOpt: { fontSize: 19 } }, slowArea)
  ]);
  assert.equal(r1.openPastChats, 10);
  assert.equal(r2.openPastChats, 10);
  assert.equal(r2.textOpt.fontSize, 19);
  const loaded = await Settings.loadSettings(slowArea);
  assert.equal(loaded.openPastChats, 10);
  assert.equal(loaded.textOpt.fontSize, 19);
});
await checkAsync('settings: load survives storage errors / missing area', async () => {
  const bad = { get: async () => { throw new Error('boom'); }, set: async () => {} };
  const origWarn = console.warn; console.warn = () => {};
  try { assert.deepEqual(await Settings.loadSettings(bad), Settings.DEFAULT_SETTINGS); } finally { console.warn = origWarn; }
  assert.deepEqual(await Settings.loadSettings(null), Settings.DEFAULT_SETTINGS);
});
check('settings: onSettingsChanged filters area/key and unsubscribes', () => {
  let listener = null; let removed = false;
  const api = { onChanged: { addListener: (l) => { listener = l; }, removeListener: (l) => { removed = l === listener; } } };
  const calls = [];
  const off = Settings.onSettingsChanged((n, o) => calls.push([n, o]), api);
  listener({ other: {} }, 'local');
  listener({ [Settings.STORAGE_KEY]: { newValue: { openPastChats: 0 } } }, 'sync');
  assert.equal(calls.length, 0);
  listener({ [Settings.STORAGE_KEY]: { newValue: { openPastChats: 0 } } }, 'local');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].openPastChats, 0);
  assert.equal(calls[0][1].openPastChats, 4);
  off();
  assert.ok(removed);
});

// ---------- collapse ----------
const ids = (n) => Array.from({ length: n }, (_, i) => 't' + (i + 1));
const count = (arr, v) => arr.filter((x) => x === v).length;
check('collapse: openPastChats 0 keeps 1 open; N keeps 1 + N open', () => {
  const s0 = Collapse.computeTurnStates({ turnIds: ids(10), openPastChats: 0, autoCollapse: true, manualOpenIds: new Set() });
  assert.equal(count(s0, 'collapsed'), 9);
  assert.equal(s0[9], 'open');
  const s4 = Collapse.computeTurnStates({ turnIds: ids(10), openPastChats: 4, autoCollapse: true, manualOpenIds: new Set() });
  assert.equal(count(s4, 'collapsed'), 5);
  assert.equal(count(s4, 'open'), 5);
  const s12 = Collapse.computeTurnStates({ turnIds: ids(10), openPastChats: 12, autoCollapse: true, manualOpenIds: new Set() });
  assert.equal(count(s12, 'collapsed'), 0);
});
check('collapse: invalid openPastChats falls back to 4 (5 open)', () => {
  const s = Collapse.computeTurnStates({ turnIds: ids(10), openPastChats: 'abc', autoCollapse: true, manualOpenIds: new Set() });
  assert.equal(count(s, 'collapsed'), 5);
});
check('collapse: manual-open survives new turns; collapseOld clears', () => {
  const st = Collapse.createCollapseState();
  st.expand('t1');
  let s = st.compute({ turnIds: ids(12), openPastChats: 4, autoCollapse: true });
  assert.equal(s[0], 'manual-open');
  assert.equal(s[1], 'collapsed');
  st.collapseOld();
  s = st.compute({ turnIds: ids(12), openPastChats: 4, autoCollapse: true });
  assert.equal(s[0], 'collapsed');
});
check('collapse: expandAll / collapse(id) / reset', () => {
  const st = Collapse.createCollapseState();
  st.expandAll(['t1', 't2']);
  let s = st.compute({ turnIds: ids(10), openPastChats: 2, autoCollapse: true });
  assert.equal(count(s, 'manual-open'), 2);
  st.collapse('t1');
  s = st.compute({ turnIds: ids(10), openPastChats: 2, autoCollapse: true });
  assert.equal(s[0], 'collapsed');
  st.reset();
  assert.equal(st.manualOpen.size, 0);
});
check('collapse: streaming turn always open', () => {
  const s = Collapse.computeTurnStates({ turnIds: ids(10), openPastChats: 0, autoCollapse: true, manualOpenIds: new Set(), streamingId: 't3' });
  assert.equal(s[2], 'open');
  assert.equal(count(s, 'collapsed'), 8);
});
check('collapse: autoCollapse false -> all open', () => {
  const s = Collapse.computeTurnStates({ turnIds: ids(10), openPastChats: 0, autoCollapse: false, manualOpenIds: new Set() });
  assert.ok(s.every((x) => x === 'open'));
});
check('collapse: computeRecollapseState 3-mode (114px Wrap pill), minTopOffset & dead helper removal', () => {
  assert.equal(Collapse.computeRecollapseOffset, undefined);
  assert.equal(typeof Collapse.getStates, 'function');

  const topSt = Collapse.computeRecollapseState({
    turnTop: 500, turnHeight: 1200, turnBottom: 1700, turnRight: 1100, minTopOffset: 96, viewportW: 1200, viewportH: 900
  });
  assert.deepEqual(topSt, { mode: 'top', top: 96, left: 978 });

  // Turn top above midTop (423), but user-query pushes effectiveTop (440) >= 423 -> stays 'top' below query
  const belowQuerySt = Collapse.computeRecollapseState({
    turnTop: 340, turnHeight: 1200, turnBottom: 1540, turnRight: 1100, minTopOffset: 100, viewportW: 1200, viewportH: 900
  });
  assert.deepEqual(belowQuerySt, { mode: 'top', top: 100, left: 978 });

  const midSt = Collapse.computeRecollapseState({
    turnTop: -200, turnHeight: 1200, turnBottom: 1000, turnRight: 1100, minTopOffset: 100, viewportW: 1200, viewportH: 900
  });
  assert.deepEqual(midSt, { mode: 'middle', top: 423, left: 978 });

  const botSt = Collapse.computeRecollapseState({
    turnTop: -1000, turnHeight: 1200, turnBottom: 200, turnRight: 1100, minTopOffset: 100, viewportW: 1200, viewportH: 900
  });
  assert.deepEqual(botSt, { mode: 'bottom', top: 1138, left: 978 });

  const tinySt = Collapse.computeRecollapseState({
    turnTop: -10, turnHeight: 50, turnBottom: 40, turnRight: 2000, viewportW: 1200, viewportH: 900
  });
  assert.equal(tinySt.mode, 'top');
  assert.equal(tinySt.left, 1200 - 114 - 8);
});

// ---------- navigator ----------
check('navigator: hover transforms symmetric, monotonic, peak at hover', () => {
  const t = Nav.computeStripTransforms({ count: 9, hoverIndex: 4 });
  for (let k = 1; k <= 4; k++) {
    assert.equal(t[4 + k].scaleX, t[4 - k].scaleX);
    assert.equal(t[4 + k].scaleY, t[4 - k].scaleY);
    assert.equal(t[4 + k].translateY, -t[4 - k].translateY);
  }
  for (let i = 1; i < t.length; i++) assert.ok(t[i].translateY >= t[i - 1].translateY, 'monotonic at ' + i);
  const maxX = Math.max(...t.map((x) => x.scaleX));
  assert.equal(t[4].scaleX, maxX);
  assert.equal(t[4].translateY, 0);
});
check('navigator: no hover -> zero translate, active widened, collapsed dimmed', () => {
  const t = Nav.computeStripTransforms({ count: 5, activeIndex: 2, collapsed: [true, false, false, false, false] });
  assert.ok(t.every((x) => x.translateY === 0 && x.scaleY === 1));
  assert.equal(t[2].scaleX, Nav.STRIP.ACTIVE_SCALE_X);
  assert.equal(t[2].opacity, 1);
  assert.equal(t[0].opacity, Nav.STRIP.COLLAPSED_OPACITY);
  assert.equal(t[4].opacity, Nav.STRIP.IDLE_OPACITY);
});
check('navigator: toTransformString', () => {
  assert.equal(Nav.toTransformString({ translateY: 3, scaleX: 1.9, scaleY: 1.67, opacity: 1 }), 'translate3d(0, 3px, 0) scale(1.9, 1.67)');
});
check('navigator: rail placement hugs textLeft and clamps dynamically across [textTop..textBottom]', () => {
  const r0 = Nav.computeRailPlacement({ anchorRect: { left: 0, top: 0, height: 800 }, viewportW: 1200, viewportH: 900, count: 5 });
  assert.equal(r0.left, 10);
  assert.ok(r0.left + 28 <= 44, 'fits inside 44px left gutter');
  const r = Nav.computeRailPlacement({ anchorRect: { left: -100, top: 0, height: 800 }, viewportW: 1200, viewportH: 900, count: 5 });
  assert.ok(r.left >= 8);
  const r2 = Nav.computeRailPlacement({ anchorRect: { left: 5000, top: 0, height: 800 }, viewportW: 1200, viewportH: 900, count: 5 });
  assert.ok(r2.left <= 1200 - 24);
  const r3 = Nav.computeRailPlacement({ anchorRect: { left: 0, top: 100, height: 800 }, viewportW: 1200, viewportH: 900, count: 500 });
  assert.ok(r3.height <= 800 - 48 && r3.height <= 900 - 96);
  assert.equal(r3.top, 100 + (800 - r3.height) / 2);

  // Dynamic textLeft + 3-mode vertical clamping
  const rTop = Nav.computeRailPlacement({
    anchorRect: { left: 0, top: 0, height: 900 }, viewportW: 1400, viewportH: 900, count: 10,
    textLeft: 320, textTop: 500, textBottom: 2000
  });
  assert.equal(rTop.left, 286);
  assert.equal(rTop.mode, 'top');
  assert.equal(rTop.top, 508);

  const rMid1 = Nav.computeRailPlacement({
    anchorRect: { left: 0, top: 0, height: 900 }, viewportW: 1400, viewportH: 900, count: 10,
    textLeft: 320, textTop: -300, textBottom: 1500
  });
  const rMid2 = Nav.computeRailPlacement({
    anchorRect: { left: 0, top: 0, height: 900 }, viewportW: 1400, viewportH: 900, count: 10,
    textLeft: 320, textTop: -600, textBottom: 1200
  });
  assert.equal(rMid1.mode, 'middle');
  assert.equal(rMid1.top, Math.round((900 - rMid1.height) / 2));
  assert.equal(rMid2.top, rMid1.top, 'middle top stays static during middle scroll');

  const rBot = Nav.computeRailPlacement({
    anchorRect: { left: 0, top: 0, height: 900 }, viewportW: 1400, viewportH: 900, count: 10,
    textLeft: 44, textTop: -2000, textBottom: 300
  });
  assert.equal(rBot.left, 10);
  assert.equal(rBot.mode, 'bottom');
  assert.equal(rBot.top, 300 - rBot.height - 8);
});

// ---------- selectors ----------
check('selectors: loads in Node without DOM and exposes v1.0 seam', () => {
  assert.ok(Object.isFrozen(Selectors.SEL));
  for (const k of ['getTurns', 'getTurnId', 'dedupePromptText', 'getPromptText', 'findComposerAnchor', 'detectTheme', 'isProtected', 'tagDynamicAttributionNodes']) {
    assert.equal(typeof Selectors[k], 'function', k);
  }
  assert.ok(Array.isArray(Selectors.SEL.composerAnchor));
  assert.ok(Array.isArray(Selectors.SEL.nativeScrollDown));
  assert.ok(Array.isArray(Selectors.SEL.a11yHidden));
  assert.equal(Selectors.findChatScroller(null), null);
  assert.equal(Selectors.findComposerAnchor(null), null);
  assert.equal(Selectors.detectTheme(null), 'light');
});
check('selectors: dedupePromptText & getPromptText strip a11y nodes and dedupe repeats', () => {
  assert.equal(Selectors.dedupePromptText('lanjut 4.6 lanjut 4.6'), 'lanjut 4.6');
  assert.equal(Selectors.dedupePromptText('You said lanjut 4.6 lanjut 4.6'), 'lanjut 4.6');
  assert.equal(Selectors.dedupePromptText('Anda berkata: halo dunia halo dunia'), 'halo dunia');
  assert.equal(Selectors.dedupePromptText('You said apa kabar You said apa kabar'), 'apa kabar');
  assert.equal(Selectors.dedupePromptText('bonbon'), 'bonbon');

  const mkLine = (text, hidden = false) => ({
    textContent: text,
    matches: () => hidden,
    closest: () => (hidden ? {} : null),
    cloneNode: () => ({ textContent: text, querySelectorAll: () => [] })
  });
  const turnMock = {
    querySelector: (s) => (s === 'user-query' ? {
      querySelectorAll: (qs) => (qs === '.query-text-line'
        ? [mkLine('You said', true), mkLine('lanjut 4.6'), mkLine('lanjut 4.6'), mkLine('mirror', true)]
        : [])
    } : null)
  };
  assert.equal(Selectors.getPromptText(turnMock), 'lanjut 4.6');
});
check('selectors: getTurnId prefers id, then data attr, then counter', () => {
  const mk = (id, attr) => ({ id, getAttribute: (n) => (n === 'data-gopt-turn' ? attr : null) });
  const c = { value: 0 };
  assert.equal(Selectors.getTurnId(mk('abc', null), c), 'abc');
  assert.equal(Selectors.getTurnId(mk('', 'gopt-9'), c), 'gopt-9');
  assert.equal(Selectors.getTurnId(mk('', null), c), 'gopt-1');
  assert.equal(Selectors.getTurnId(mk('', null), c), 'gopt-2');
});
const overlay = read('src', 'content', 'ui-overlay.css');

function mockCandidate({ text, protectedDescendant = false, tag = 'DIV', cls = '' }) {
  const attrs = {};
  return {
    tagName: tag, textContent: text, innerText: text, childElementCount: 1, attrs,
    getAttribute: (n) => (n === 'class' ? cls : null),
    setAttribute(n, v) { attrs[n] = v; },
    closest: () => null,
    querySelector: () => (protectedDescendant ? {} : null),
    getBoundingClientRect: () => ({ height: 20 })
  };
}
function mockRoot(cands, len) {
  const response = { textContent: 'x'.repeat(len), querySelectorAll: () => cands };
  return { querySelectorAll: (s) => (s === 'model-response' ? [response] : []) };
}
check('selectors: tagDynamicAttributionNodes tags plain attribution wrapper', () => {
  const c = mockCandidate({ text: 'Menggunakan info dari Google Drive' });
  assert.equal(Selectors.tagDynamicAttributionNodes(mockRoot([c], 11)), 1);
  assert.equal(c.attrs['data-gopt-attribution'], '1');
});
check('selectors: wrapper containing a protected descendant is never tagged (regression)', () => {
  const wrapper = mockCandidate({ text: 'Sources', protectedDescendant: true });
  assert.equal(Selectors.tagDynamicAttributionNodes(mockRoot([wrapper], 12)), 0);
  assert.ok(!('data-gopt-attribution' in wrapper.attrs));
  assert.equal(Selectors.hasProtectedDescendant(wrapper), true);
  assert.equal(Selectors.hasProtectedDescendant(mockCandidate({ text: 'x' })), false);
});
check('selectors: ordinary text and long text are not tagged', () => {
  const a = mockCandidate({ text: 'Berikut ringkasan jawaban Anda' });
  const b = mockCandidate({ text: 'Sources ' + 'z'.repeat(200) });
  assert.equal(Selectors.tagDynamicAttributionNodes(mockRoot([a, b], 13)), 0);
});
check('collapse: onStateChange, startStickyTrack, snippetCache rawLen fast-path & selectors attribution pre-filter', () => {
  assert.equal(typeof Collapse.onStateChange, 'function');
  assert.equal(typeof Collapse.startStickyTrack, 'function');
  const off = Collapse.onStateChange(() => {});
  assert.equal(typeof off, 'function');
  off();
  const cSrc = read('src', 'content', 'collapse-manager.js');
  assert.ok(/btnMap\s*=\s*new WeakMap/.test(cSrc));
  assert.ok(/portaledBtns\s*=\s*new Set/.test(cSrc));
  assert.ok(/data-gopt-for/.test(cSrc));
  assert.ok(/function parkBtnInTurn/.test(cSrc));
  assert.ok(/minTopOffset/.test(cSrc) && /SEL\.userQuery/.test(cSrc));
  const applyFn = cSrc.slice(cSrc.indexOf('function applyOne'));
  const rawLenIdx = applyFn.indexOf('rawLen');
  const cloneIdx = applyFn.indexOf('getPromptText(');
  assert.ok(rawLenIdx > 0 && cloneIdx > rawLenIdx, 'snippetCache rawLen fast-path must precede getPromptText');
  assert.equal(typeof Collapse.getStates, 'function');
  assert.ok(/\bgetStates\b/.test(cSrc) && /\bnotify\(\)/.test(cSrc));

  const selSrc = read('src', 'shared', 'selectors.js');
  assert.ok(!/\.innerText\b/.test(selSrc), 'selectors.js must avoid layout-forcing innerText');
  const imgIdx = selSrc.indexOf("querySelector('img')");
  const rectIdx = selSrc.indexOf('getBoundingClientRect()');
  assert.ok(imgIdx > 0 && rectIdx > imgIdx, 'attribution filter must pre-check cheap conditions before getBoundingClientRect');
});
check('navigator & main: open-turn bounds, RO dedup, tooltip status, pagehide cleanup & streaming skip', () => {
  assert.equal(typeof Nav.startSmoothTrack, 'function');
  const src = read('src', 'content', 'strip-navigator.js');
  assert.ok(/function cancelMove\(\)/.test(src));
  assert.ok(/pointerleave', function \(\) \{ cancelMove\(\)/.test(src));
  assert.ok(/cancelMove\(\);\s*\n\s*S\.hover = -1/.test(src), 'reset cancels moveRaf');
  assert.ok(/cancelAnimationFrame\(S\.placeRaf\)/.test(src), 'destroy cancels placeRaf');
  assert.ok(/S\.ioRoot !== scroller|S\.ioRoot === scroller/.test(src), 'ioRoot tracked');
  assert.ok(/pointerType === 'touch'/.test(src), 'touch gated');
  assert.ok(/removeAttribute\('aria-describedby'\)/.test(src), 'aria-describedby cleared');
  assert.ok(/function startSmoothTrack/.test(src), 'smooth track present');
  assert.ok(/transitionstart/.test(src), 'transitionstart listener present');
  assert.ok(/Jump to Past Chat #/.test(src), 'Past Chat aria-label');
  assert.ok(/function measureContentLeft/.test(src), 'dynamic textLeft measurement');
  assert.ok(/firstOpenIdx/.test(src) && /lastOpenIdx/.test(src), 'open-turn-only vertical clamping');
  assert.ok(/function sameElements/.test(src) && /roTargets/.test(src), 'navigator ResizeObserver target dedup');
  assert.ok(/gopt-tooltip-head/.test(src) && /gopt-tooltip-status/.test(src), 'tooltip status pill in navigator');
  const main = read('src', 'content', 'main.js');
  assert.ok(/Collapse\.onStateChange\(syncAfterCollapseChange\)/.test(main));
  assert.ok(/gopt-text-fullwidth/.test(main));
  assert.ok(/state\.turnCount > 0/.test(main), 'home-screen exemption requires turnCount > 0 for full-width');
  assert.ok(/--gopt-content-width/.test(main), 'main syncs --gopt-content-width root var');
  assert.ok(/prevWidth !== nextWidth/.test(main) && /startStickyTrack\(220\)/.test(main));
  assert.ok(/gopt-width-animating/.test(main));
  assert.ok(/Collapse\.startStickyTrack\(280\)/.test(main) && /Navigator\.startSmoothTrack\(280\)/.test(main));
  assert.ok(/function sameElements/.test(main) && /scrollBtnRoTargets/.test(main), 'main ResizeObserver target dedup');
  assert.ok(/wasStreaming/.test(main), 'main skips heavy dynamic attribution scan during active streaming');
  assert.ok(/window\.addEventListener\('pagehide',\s*cleanup\)/.test(main), 'main registers persistent pagehide cleanup');
  assert.ok(/ev && ev\.persisted/.test(main), 'main skips pagehide teardown when persisted in BFCache');
  assert.ok(/function goToTurn[\s\S]*?refreshNow\(\)/.test(main), 'goToTurn calls refreshNow to stay synced');
});
check('selectors: every SEL.sourcesStatic and SEL.nativeScrollDown entry appears in ui-overlay.css', () => {
  for (const s of Selectors.SEL.sourcesStatic) assert.ok(overlay.includes(s), 'missing source in CSS: ' + s);
  for (const s of Selectors.SEL.nativeScrollDown) assert.ok(overlay.includes(s), 'missing scrollDown in CSS: ' + s);
});

// ---------- manifest ----------
const manifest = JSON.parse(read('manifest.json'));
check('manifest: MV3 + semver version', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});
check('manifest: every referenced file exists; ui-overlay at document_start', () => {
  const files = [manifest.action.default_popup, ...Object.values(manifest.action.default_icon), ...Object.values(manifest.icons)];
  for (const cs of manifest.content_scripts) files.push(...(cs.css || []), ...(cs.js || []));
  for (const f of files) assert.ok(fs.existsSync(p(f)), 'missing: ' + f);
  const start = manifest.content_scripts.find((c) => c.run_at === 'document_start');
  assert.deepEqual(start.css, ['src/content/early-perf.css', 'src/content/ui-overlay.css']);
  assert.deepEqual(start.js, ['src/content/early-boot.js']);
  const end = manifest.content_scripts.find((c) => c.run_at === 'document_end');
  assert.ok(end && Array.isArray(end.js));
  assert.equal(end.js[end.js.length - 1], 'src/content/main.js');
});

// ---------- icons ----------
check('icons: valid PNG header, IHDR size, CRCs, IEND', () => {
  for (const size of [16, 48, 128]) {
    const b = fs.readFileSync(p('icons', `icon${size}.png`));
    assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'signature ' + size);
    assert.equal(b.toString('ascii', 12, 16), 'IHDR');
    assert.equal(b.readUInt32BE(16), size, 'width ' + size);
    assert.equal(b.readUInt32BE(20), size, 'height ' + size);
    let off = 8, sawEnd = false, idat = [];
    while (off < b.length) {
      const len = b.readUInt32BE(off); const type = b.toString('ascii', off + 4, off + 8);
      const data = b.subarray(off + 8, off + 8 + len);
      if (typeof zlib.crc32 === 'function') {
        assert.equal(b.readUInt32BE(off + 8 + len), zlib.crc32(b.subarray(off + 4, off + 8 + len)), 'crc ' + type);
      }
      if (type === 'IDAT') idat.push(data);
      if (type === 'IEND') sawEnd = true;
      off += 12 + len;
    }
    assert.ok(sawEnd && off === b.length, 'IEND last ' + size);
    const raw = zlib.inflateSync(Buffer.concat(idat));
    assert.equal(raw.length, (size * 4 + 1) * size, 'pixel data size ' + size);
  }
});

// ---------- guardrails (Blueprint section 11 + v1.0 follow-up) ----------
const cssFiles = [read('src', 'content', 'early-perf.css'), overlay, read('src', 'popup', 'popup.css')];
const popupHtml = read('src', 'popup', 'popup.html');
const popupJs = read('src', 'popup', 'popup.js');
check('guardrails: no transition:all / scale(0) / ease-in', () => {
  for (const css of cssFiles) {
    assert.ok(!/transition\s*:\s*all/i.test(css), 'transition: all');
    assert.ok(!/scale\(\s*0\s*[,)]/.test(css), 'scale(0)');
    assert.ok(!/ease-in(?!-out)/.test(css.replace(/--[\w-]*ease-in-out/g, '')), 'ease-in');
  }
});
check('guardrails: no layout properties in permanent transition-property list', () => {
  for (const css of cssFiles) {
    // Strip the temporary 240ms width-toggle transition block gated under html.gopt-width-animating.
    const stripped = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{\s*html\.gopt-width-animating[\s\S]*?\n\}/g, '');
    for (const m of stripped.matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)) {
      assert.ok(!/\b(width|height|margin|padding|top|left|right|bottom)\b/.test(m[1]), 'layout prop in: ' + m[0]);
    }
  }
});
check('guardrails: no var() in transform; CSS vars set in JS only on documentElement root for textOpt', () => {
  for (const css of cssFiles) {
    for (const m of css.matchAll(/transform\s*:\s*[^;]*var\(/g)) assert.fail('var() in transform: ' + m[0]);
  }
  const allowedRootVar = /^document\.documentElement\.style\.setProperty\(\s*varName\b|^document\.documentElement\.style\.setProperty\(\s*['"]--gopt-(content-width|font-size|line-height|paragraph-gap|letter-spacing)['"]/;
  for (const f of walk(p('src'), '.js')) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/[.\w]+\.style\.setProperty\(\s*[^;]+/g)) {
      assert.ok(allowedRootVar.test(m[0]), 'disallowed style.setProperty in ' + path.relative(ROOT, f) + ': ' + m[0]);
    }
  }
});
check('guardrails: popup English UI, crisp logo, contentWidth slider, no preview, stepper, accordion, flush', () => {
  assert.ok(/^[\x00-\x7f]*$/.test(popupHtml), 'non-ASCII in popup.html');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(popupHtml), 'inline script');
  assert.ok(popupHtml.indexOf('settings.js') < popupHtml.indexOf('popup.js'));
  assert.ok((popupHtml.match(/<svg/g) || []).length >= 7);
  assert.ok(popupHtml.includes('fill="#0b57d0"'), 'crisp brand blue popup logo');
  assert.ok(popupHtml.includes('id="ext-version"') && popupHtml.includes('class="pill-dot"'));
  assert.ok(popupHtml.includes('Hide Sources &amp; Citations') && popupHtml.includes('Wrap Long Chats'));
  assert.ok(popupHtml.includes('Open Past Chats'));
  assert.ok(/id="openPastChats"[^>]*type="number"|type="number"[^>]*id="openPastChats"/.test(popupHtml));
  assert.ok(popupHtml.includes('id="openPastDec"') && popupHtml.includes('id="openPastInc"'));
  assert.ok(popupHtml.includes('id="openPastChats-wrap"') && popupHtml.includes('acc-collapse'));
  assert.ok(popupHtml.includes('id="textFullWidth"') && popupHtml.includes('Full Width'));
  assert.ok(popupHtml.includes('id="contentWidth-wrap"') && popupHtml.includes('id="contentWidth"') && popupHtml.includes('min="60" max="100"'));
  assert.ok(popupHtml.includes('id="textOpt-panel"') && popupHtml.includes('id="resetTextOpt"') && popupHtml.includes('Reset Typography'));
  assert.ok(popupHtml.includes('Open All') && popupHtml.includes('Wrap Old'));
  assert.ok(!popupHtml.includes('textOpt-preview') && !popupHtml.includes('tp-prose'), 'preview removed from HTML');
  assert.ok(!popupHtml.includes('lightRenderMode') && !popupHtml.includes('animationsEnabled'));
  assert.ok(!popupJs.includes('previewProses') && !popupJs.includes('PREVIEW_FONTS'), 'preview removed from JS');
  assert.ok(popupJs.includes('Past Chat') && popupJs.includes('wrapped'));
  assert.ok(popupJs.includes('DEFAULT_TYPOGRAPHY_RESET'));
  assert.ok(/\.group > \.row > \.switch/.test(popupJs), 'top-level switch query excludes textFullWidth');
  assert.ok(/function flushPendingTextOpt/.test(popupJs));
  assert.ok(/visibilitychange/.test(popupJs) && /pagehide/.test(popupJs) && /unload/.test(popupJs));
  assert.ok(/is-done/.test(popupJs) && /backgroundSize/.test(popupJs));
  const pCss = read('src', 'popup', 'popup.css');
  assert.ok(!pCss.includes('.type-preview') && !pCss.includes('.tp-prose'), 'preview removed from CSS');
  assert.ok(/\.acc-collapse/.test(pCss) && /grid-template-rows:\s*0fr/.test(pCss) && /grid-template-rows:\s*1fr/.test(pCss));
  assert.ok(/\.stepper/.test(pCss) && /\.pill-dot/.test(pCss) && /\.action\.is-done/.test(pCss));
  assert.ok(/prefers-reduced-motion:\s*reduce/.test(pCss));
});
check('guardrails: hover rules gated; reduced-motion present', () => {
  for (const css of [overlay, read('src', 'popup', 'popup.css')]) {
    assert.ok(/prefers-reduced-motion:\s*reduce/.test(css), 'reduced motion');
    const ungated = css.replace(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\n\}/g, '');
    assert.ok(!/:hover/.test(ungated.replace(/\.gopt-rail:hover \.gopt-strip-bar \{ will-change: transform; \}/, '')), 'ungated :hover');
  }
});
check('guardrails: durations < 300ms', () => {
  for (const css of cssFiles) {
    for (const m of css.matchAll(/(\d+)ms/g)) assert.ok(Number(m[1]) < 300, m[0]);
  }
});

// ---------- v1.2 LR26 CSS contracts ----------
check('early-perf: LR26 block/flex chain, scroller full-width, configurable 60..100% centering, gutters & width-animating', () => {
  const css = read('src', 'content', 'early-perf.css');
  assert.ok(/\.conversation-container:last-child/.test(css));
  assert.ok(/\[data-gopt-turn\]:last-child/.test(css));
  assert.ok(/content-visibility:\s*visible/.test(css));
  assert.ok(/:not\(\.gopt-turn-collapsed\)/.test(css));
  assert.ok(/html\.gopt-text-fullwidth\b/.test(css));
  assert.ok(css.includes('.chat-history-scroll-container') && css.includes('#chat-history') && css.includes('[data-test-id="chat-history-container"]'));
  assert.ok(!/(?:^|[,\s(])chat-window(?:\s*[,)])/m.test(css), 'standalone chat-window must be excluded from width: 100% (protects Canvas split-pane)');
  assert.ok(/align-items:\s*stretch !important/.test(css));
  assert.ok(css.includes('response-container') && css.includes('model-response-content') && css.includes('message-content'));
  assert.ok(css.includes('display: block !important') && css.includes('flex-basis: auto !important'));
  assert.ok(/width:\s*var\(--gopt-content-width, 100%\) !important/.test(css));
  assert.ok(/max-width:\s*var\(--gopt-content-width, 100%\) !important/.test(css));
  assert.ok(/margin-inline:\s*auto !important/.test(css));
  const bubbleMatch = css.match(/html\.gopt-text-fullwidth\s+\.user-query-bubble-with-background\s*\{[^}]*\}/);
  assert.ok(bubbleMatch && /max-width:\s*100% !important/.test(bubbleMatch[0]) && !/(?:^|[;\s])width:\s*100%/.test(bubbleMatch[0]), 'user bubble should cap max-width without forcing width: 100%');
  assert.ok(/padding-left:\s*44px/.test(css) && /padding-right:\s*74px/.test(css));
  assert.ok(/html\.gopt-text-fullwidth\s+:is\(input-container, input-area-v2, \.input-area-container, \.bottom-container\):not\(:is\(input-container, input-area-v2, \.input-area-container, \.bottom-container\) \*\)/.test(css));
  assert.ok(!/input-area-v2\s*>\s*\*[^}]*width:\s*100%/s.test(css), 'must not stretch buttons with > * width:100%');
  assert.ok(/html\.gopt-width-animating[\s\S]*transition-property:\s*width, max-width, padding-left, padding-right;[\s\S]*240ms/.test(css));
});
check('ui-overlay: light-render width gating, bar-index, tooltip status, starting-style, 114px Wrap pill & resets', () => {
  const rule = overlay.match(/\.gopt-strip-bar\s*\{[^}]*\}/)[0];
  assert.ok(!/will-change/.test(rule), 'will-change in idle rule');
  assert.ok(/\.gopt-rail:hover \.gopt-strip-bar\s*\{\s*will-change:\s*transform/.test(overlay));
  assert.ok(/html\.gopt-light-render:not\(\.gopt-width-animating\)/.test(overlay), 'light-render transition suppression must allow width-animating');
  assert.ok(/\.gopt-bar-index\s*\{/.test(overlay));
  assert.ok(/\.gopt-tooltip-head\s*\{/.test(overlay) && /\.gopt-tooltip-status\s*\{/.test(overlay));
  assert.ok(/\.gopt-turn-manual-open\s*>/.test(overlay) && /@starting-style/.test(overlay));
  assert.ok(/\.gopt-turn-collapsed,\s*:is\(div, section, article\):has\(> \.gopt-turn-collapsed\)/.test(overlay));
  assert.ok(/row-gap:\s*2px !important/.test(overlay));
  assert.ok(/:not\(\.gopt-turn-collapsed\)\s*\{\s*margin-bottom:\s*20px !important/.test(overlay));
  assert.ok(/\.gopt-collapsed-bar\s*\{[^}]*min-height:\s*44px;[^}]*margin:\s*1px 0 !important/s.test(overlay));
  assert.ok(/html\.gopt-font-sans[^\n{]*\.gopt-collapsed-bar/.test(overlay));
  assert.ok(/html\.gopt-text-size[^\n{]*\.gopt-collapsed-bar/.test(overlay));
  assert.ok(/\.gopt-recollapse-pill\s*\{[^}]*width:\s*114px;\s*\n\s*height:\s*54px;[^}]*clip-path:\s*inset\(0 0 0 60px/s.test(overlay));
  assert.ok(/html\.gopt-active \.gopt-recollapse-btn\.is-sticky-mid\s*\{[^}]*position:\s*fixed;[^}]*top:\s*calc\(50vh - 27px\)/s.test(overlay));
  assert.ok(/\.gopt-scroll-bottom-btn\s*\{[^}]*width:\s*54px;\s*\n\s*height:\s*54px;/s.test(overlay));
  assert.ok(/html\.gopt-text-ls[\s\S]*letter-spacing:\s*normal !important/.test(overlay));
  assert.ok(/:is\(html\.gopt-font-sans, html\.gopt-font-serif, html\.gopt-font-mono\)[\s\S]*:is\(table, table \*\)/.test(overlay));
  assert.ok(/:is\(html\.gopt-font-sans, html\.gopt-font-serif, html\.gopt-font-mono\)[\s\S]*:is\(pre, code, code-block, pre \*, code \*, code-block \*\)/.test(overlay));
  assert.ok(/pendingTextOpt = Object\.assign/.test(popupJs), 'popup accumulates pending textOpt patches');
});

// ---------- early-boot & cold-load optimization (Stages 1-3) ----------
check('early-boot: parseEarlyMirror, readEarlyMirror & writeEarlyMirror parity + resilience', () => {
  assert.deepEqual(Early.DEFAULT_EARLY, { autoCollapse: true, openPastChats: 4, hideSources: true });
  assert.deepEqual(Early.parseEarlyMirror(null), Early.DEFAULT_EARLY);
  assert.deepEqual(Early.parseEarlyMirror('{bad json'), Early.DEFAULT_EARLY);
  assert.deepEqual(Early.parseEarlyMirror([]), Early.DEFAULT_EARLY);
  assert.deepEqual(Early.parseEarlyMirror({ autoCollapse: false, openPastChats: -0, hideSources: false }), {
    autoCollapse: false, openPastChats: 0, hideSources: false
  });
  assert.equal(Object.is(Early.parseEarlyMirror({ openPastChats: -0 }).openPastChats, -0), false);
  assert.equal(Early.parseEarlyMirror({ openPastChats: 1500 }).openPastChats, 999);
  assert.equal(Early.parseEarlyMirror({ openPastChats: -3 }).openPastChats, 0);
  assert.equal(Early.parseEarlyMirror({ openPastChats: true }).openPastChats, 4);
  assert.equal(Early.parseEarlyMirror({ openPastChats: '' }).openPastChats, 4);
  assert.equal(Early.parseEarlyMirror({ openPastChats: NaN }).openPastChats, 4);

  const mem = {};
  const ls = { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
  const written = Early.writeEarlyMirror({ autoCollapse: false, openPastChats: 7.9, hideSources: false, extra: 1 }, ls);
  assert.deepEqual(written, { autoCollapse: false, openPastChats: 7, hideSources: false });
  assert.deepEqual(Early.readEarlyMirror(ls), written);

  const badLs = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(Early.writeEarlyMirror({ openPastChats: 9 }, badLs), { autoCollapse: true, openPastChats: 9, hideSources: true });
  assert.deepEqual(Early.readEarlyMirror(badLs), Early.DEFAULT_EARLY);
});

check('early-boot: buildPrewrapCss & shouldUseImmediateRefresh contracts', () => {
  assert.equal(Early.buildPrewrapCss(4, false), '');
  const css = Early.buildPrewrapCss(4, true);
  assert.ok(css.includes('html.gopt-prewrap .conversation-container:not([data-gopt-turn]):nth-last-child(n + 6 of .conversation-container)'));
  assert.ok(css.includes('html.gopt-prewrap [data-test-id="conversation-turn"]:not([data-gopt-turn]):nth-last-child(n + 6 of [data-test-id="conversation-turn"])'));
  assert.ok(css.includes('contain: layout style paint !important') && css.includes('height: 44px !important'));

  assert.equal(Early.shouldUseImmediateRefresh({ coldLoading: true, turnCount: 50, hasElementMutation: false }), true);
  assert.equal(Early.shouldUseImmediateRefresh({ coldLoading: false, turnCount: 0, hasElementMutation: true }), true);
  assert.equal(Early.shouldUseImmediateRefresh({ coldLoading: false, turnCount: 0, hasElementMutation: false }), false);
  assert.equal(Early.shouldUseImmediateRefresh({ coldLoading: false, turnCount: 10, hasElementMutation: true }), false);
  assert.equal(Early.shouldUseImmediateRefresh(null), false);
});

check('early-boot: applyPrewrap (head===null fallback, no gopt-text-fullwidth) & startColdLoad/endColdLoad', () => {
  const classes = new Set();
  const rootChildren = [];
  const attrs = {};
  const styleNode = {
    id: '', textContent: '', parentNode: null,
    setAttribute: (k, v) => { attrs[k] = v; },
    remove() {
      if (this.parentNode) {
        const i = this.parentNode.indexOf(this);
        if (i >= 0) this.parentNode.splice(i, 1);
        this.parentNode = null;
      }
    }
  };
  const mockDoc = {
    head: null,
    documentElement: {
      classList: {
        contains: (c) => classes.has(c),
        toggle: (c, on) => { if (on === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); } else if (on) classes.add(c); else classes.delete(c); },
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c)
      },
      appendChild: (el) => { rootChildren.push(el); el.parentNode = rootChildren; }
    },
    getElementById: (id) => (styleNode.parentNode && styleNode.id === id ? styleNode : null),
    createElement: () => styleNode
  };

  Early.applyPrewrap(mockDoc, { autoCollapse: true, openPastChats: 2, hideSources: true });
  assert.equal(rootChildren.length, 1);
  assert.equal(styleNode.id, Early.PREWRAP_STYLE_ID);
  assert.equal(attrs['data-gopt-owned'], '');
  assert.ok(styleNode.textContent.includes('nth-last-child(n + 4 of .conversation-container)'));
  assert.ok(classes.has('gopt-prewrap') && classes.has('gopt-hide-sources') && classes.has('gopt-light-render'));
  assert.ok(!classes.has('gopt-text-fullwidth'), 'early-boot must never set gopt-text-fullwidth');

  Early.applyPrewrap(mockDoc, { autoCollapse: false, openPastChats: 2, hideSources: false });
  assert.equal(rootChildren.length, 0);
  assert.ok(!classes.has('gopt-prewrap') && !classes.has('gopt-hide-sources'));

  const timers = new Map();
  let nextId = 1;
  const mockWin = {
    setTimeout: (fn, _ms) => { const id = nextId++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); }
  };
  Early.startColdLoad(mockDoc, mockWin, 500);
  assert.ok(classes.has('gopt-cold-loading') && timers.size === 1);
  Early.endColdLoad(mockDoc, mockWin);
  assert.ok(!classes.has('gopt-cold-loading') && timers.size === 0);

  Early.startColdLoad(mockDoc, mockWin, 500);
  assert.ok(classes.has('gopt-cold-loading'));
  for (const fn of Array.from(timers.values())) fn();
  assert.ok(!classes.has('gopt-cold-loading'), 'cap timer clears gopt-cold-loading');
});

check('collapse & stages 2-3: deferMediaInTurn lazy/async idempotency, cold-loading CSS & main fast-path', () => {
  const makeImg = (src) => {
    const a = { src };
    return {
      getAttribute: (k) => a[k] ?? null,
      setAttribute: (k, v) => { a[k] = v; },
      _attrs: a
    };
  };
  const imgs = [makeImg('https://example.com/a.png'), makeImg('https://example.com/b.png')];
  const turn = { querySelectorAll: () => imgs };
  assert.equal(Collapse.deferMediaInTurn(turn), 2);
  assert.equal(imgs[0]._attrs.loading, 'lazy');
  assert.equal(imgs[0]._attrs.decoding, 'async');
  assert.equal(imgs[0]._attrs.src, 'https://example.com/a.png');
  assert.equal(imgs[1]._attrs.loading, 'lazy');
  assert.equal(Collapse.deferMediaInTurn(turn), 0, 'WeakSet makes deferMediaInTurn idempotent');
  assert.equal(Collapse.deferMediaInTurn(null), 0);

  const earlyPerf = read('src', 'content', 'early-perf.css');
  assert.ok(/html\.gopt-cold-loading:not\(\.gopt-width-animating\)/.test(earlyPerf));
  const collapsedContainMatch = overlay.match(/\.gopt-turn-collapsed\s*\{[^}]*\}/);
  assert.ok(collapsedContainMatch && /contain:\s*layout style !important/.test(collapsedContainMatch[0]));
  assert.ok(!/contain:[^;]*paint/.test(collapsedContainMatch[0]), 'must not clip focus-visible outline with contain: paint');

  const main = read('src', 'content', 'main.js');
  assert.ok(main.includes('requestIdleCallback') && main.includes('writeEarlyMirror') && main.includes('refreshRaf'));
});

// ---------- syntax ----------
check('syntax: node --check on every src/**/*.js', () => {
  const files = walk(p('src'), '.js');
  assert.ok(files.length >= 7, 'expected >= 7 js files, got ' + files.length);
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, path.relative(ROOT, f) + ': ' + r.stderr);
  }
});

if (failures.length) {
  console.error('FAIL ' + failures.length + ' of ' + (passed + failures.length) + ' checks');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log('PASS ' + passed + ' checks');
