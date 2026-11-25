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
const Folders = require('../src/content/folder-manager.js');
const Early = require('../src/content/early-boot.js');
const TokenTracker = require('../src/content/token-tracker.js');
const UsageSync = require('../src/background/usage-sync.js');

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
    autoCollapse: true, openPastChats: 4, hideSources: true, showTokenUsage: true, liteLatex: false, showFolders: true, textOpt: Settings.DEFAULT_TEXT_OPT
  });
  assert.equal(Settings.normalizeSettings({ showTokenUsage: false }).showTokenUsage, false);
  assert.equal(Settings.normalizeSettings({ showTokenUsage: 'no' }).showTokenUsage, true);
  assert.equal(Settings.normalizeSettings({ liteLatex: true }).liteLatex, true);
  assert.equal(Settings.normalizeSettings({ liteLatex: 'yes' }).liteLatex, false);
  assert.equal(Settings.normalizeSettings({ showFolders: false }).showFolders, false);
  assert.equal(Settings.normalizeSettings({ showFolders: 'no' }).showFolders, true);
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
check('manifest: every referenced file exists; background SW + document_start/end bundles valid', () => {
  assert.ok(manifest.background && manifest.background.service_worker === 'src/background/usage-sync.js');
  const files = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.action.default_icon), ...Object.values(manifest.icons)];
  for (const cs of manifest.content_scripts) files.push(...(cs.css || []), ...(cs.js || []));
  for (const f of files) assert.ok(fs.existsSync(p(f)), 'missing: ' + f);
  const start = manifest.content_scripts.find((c) => c.run_at === 'document_start');
  assert.deepEqual(start.css, ['src/content/early-perf.css', 'src/content/ui-overlay.css']);
  assert.deepEqual(start.js, ['src/content/early-boot.js']);
  const end = manifest.content_scripts.find((c) => c.run_at === 'document_end');
  assert.ok(end && Array.isArray(end.js));
  assert.equal(end.js[end.js.length - 1], 'src/content/main.js');
  assert.equal(end.js[end.js.length - 2], 'src/content/token-tracker.js');
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
  assert.ok(popupHtml.includes('id="showTokenUsage"') && popupHtml.includes('Token Usage') && popupHtml.includes('official 5h/weekly usage'));
  assert.ok(popupHtml.includes('id="liteLatex"') && popupHtml.includes('Lite LaTeX Render') && popupHtml.includes('aria-checked="false"'));
  assert.ok(popupHtml.includes('id="showFolders"') && popupHtml.includes('Conversation Folders') && popupHtml.includes('aria-checked="true"'));
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
  assert.ok(/\.gopt-turn-collapsed,\s*:is\(infinite-scroller\.chat-history, #chat-history, \[data-test-id="chat-history-container"\], main \.chat-history\) > :is\(div, section, article\):has\(> \.gopt-turn-collapsed\)/.test(overlay));
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
  assert.deepEqual(Early.DEFAULT_EARLY, { autoCollapse: true, openPastChats: 4, hideSources: true, liteLatex: false });
  assert.deepEqual(Early.parseEarlyMirror(null), Early.DEFAULT_EARLY);
  assert.deepEqual(Early.parseEarlyMirror('{bad json'), Early.DEFAULT_EARLY);
  assert.deepEqual(Early.parseEarlyMirror([]), Early.DEFAULT_EARLY);
  assert.deepEqual(Early.parseEarlyMirror({ autoCollapse: false, openPastChats: -0, hideSources: false, liteLatex: true }), {
    autoCollapse: false, openPastChats: 0, hideSources: false, liteLatex: true
  });
  assert.equal(Object.is(Early.parseEarlyMirror({ openPastChats: -0 }).openPastChats, -0), false);
  assert.equal(Early.parseEarlyMirror({ openPastChats: 1500 }).openPastChats, 999);
  assert.equal(Early.parseEarlyMirror({ openPastChats: -3 }).openPastChats, 0);
  assert.equal(Early.parseEarlyMirror({ openPastChats: true }).openPastChats, 4);
  assert.equal(Early.parseEarlyMirror({ openPastChats: '' }).openPastChats, 4);
  assert.equal(Early.parseEarlyMirror({ openPastChats: NaN }).openPastChats, 4);

  const mem = {};
  const ls = { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
  const written = Early.writeEarlyMirror({ autoCollapse: false, openPastChats: 7.9, hideSources: false, liteLatex: true, extra: 1 }, ls);
  assert.deepEqual(written, { autoCollapse: false, openPastChats: 7, hideSources: false, liteLatex: true });
  assert.deepEqual(Early.readEarlyMirror(ls), written);

  const badLs = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(Early.writeEarlyMirror({ openPastChats: 9 }, badLs), { autoCollapse: true, openPastChats: 9, hideSources: true, liteLatex: false });
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

  Early.applyPrewrap(mockDoc, { autoCollapse: true, openPastChats: 2, hideSources: true, liteLatex: true });
  assert.equal(rootChildren.length, 1);
  assert.equal(styleNode.id, Early.PREWRAP_STYLE_ID);
  assert.equal(attrs['data-gopt-owned'], '');
  assert.ok(styleNode.textContent.includes('nth-last-child(n + 4 of .conversation-container)'));
  assert.ok(classes.has('gopt-prewrap') && classes.has('gopt-hide-sources') && classes.has('gopt-light-render') && classes.has('gopt-lite-latex'));
  assert.ok(!classes.has('gopt-text-fullwidth'), 'early-boot must never set gopt-text-fullwidth');

  Early.applyPrewrap(mockDoc, { autoCollapse: false, openPastChats: 2, hideSources: false, liteLatex: false });
  assert.equal(rootChildren.length, 0);
  assert.ok(!classes.has('gopt-prewrap') && !classes.has('gopt-hide-sources') && !classes.has('gopt-lite-latex'));

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

// ---------- token-tracker (auto plan, estimator, rolling 24h/7d quota & bar/tooltip contracts) ----------
check('token-tracker: estimateTokens, formatCompactTokens & formatCountdown', () => {
  assert.equal(TokenTracker.estimateTokens(''), 0);
  assert.equal(TokenTracker.estimateTokens('   \n\t '), 0);
  assert.equal(TokenTracker.estimateTokens(null), 0);
  const prose = TokenTracker.estimateTokens('Hello world this is a simple English sentence.');
  const code = TokenTracker.estimateTokens('function f(a, b) { return a.map((x) => x + b[0]); }');
  const cjk = TokenTracker.estimateTokens('\u4eca\u65e5\u306f\u826f\u3044\u5929\u6c17\u3067\u3059');
  assert.ok(prose >= 8 && prose <= 16, 'prose estimate reasonable: ' + prose);
  assert.ok(code >= 12 && code <= 32, 'code estimate reasonable: ' + code);
  assert.ok(cjk >= 10, 'CJK estimate > char count: ' + cjk);

  assert.equal(TokenTracker.formatCompactTokens(450), '450');
  assert.equal(TokenTracker.formatCompactTokens(12400), '12.4k');
  assert.equal(TokenTracker.formatCompactTokens(128000), '128k');
  assert.equal(TokenTracker.formatCompactTokens(1000000), '1M');
  assert.equal(TokenTracker.formatCountdown(0), '');
  assert.equal(TokenTracker.formatCountdown(5 * 60000), '5m');
  assert.equal(TokenTracker.formatCountdown((23 * 60 + 15) * 60000), '23h 15m');
  assert.equal(TokenTracker.formatCountdown((6 * 24 + 23) * 3600000), '6d 23h');
});

check('token-tracker: bilingual plan badge, model tier, resolvePlan priority & dead heuristics removed', () => {
  assert.equal(TokenTracker.classifyPlanText('AI Ultra'), 'ultra');
  assert.equal(TokenTracker.classifyPlanText('AI Pro'), 'pro');
  assert.equal(TokenTracker.classifyPlanText('Gemini Advanced'), 'pro');
  assert.equal(TokenTracker.classifyPlanText('AI Plus'), 'plus');
  assert.equal(TokenTracker.classifyPlanText('Upgrade to Gemini Advanced'), 'free');
  assert.equal(TokenTracker.classifyPlanText('Tingkatkan ke Gemini'), 'free');
  assert.equal(TokenTracker.classifyPlanText('Unrelated button'), null);

  assert.equal(TokenTracker.classifyModelTierText('2.5 Pro'), 'pro');
  assert.equal(TokenTracker.classifyModelTierText('3 Pro Thinking'), 'pro');
  assert.equal(TokenTracker.classifyModelTierText('Hydrogen Tinggi'), 'pro');
  assert.equal(TokenTracker.classifyModelTierText('Neon High'), 'pro');
  assert.equal(TokenTracker.classifyModelTierText('Argon'), 'pro');
  assert.equal(TokenTracker.classifyModelTierText('Tinggi'), 'pro');
  assert.equal(TokenTracker.classifyModelTierText('Deep Research'), 'pro');
  assert.equal(TokenTracker.classifyModelTierText('2.5 Flash'), 'free');
  assert.equal(TokenTracker.classifyPlanText('Pro'), 'pro');

  assert.deepEqual(TokenTracker.resolvePlan({ badgePlan: 'ultra', modelPlan: 'free', storedPlan: 'free' }), { plan: 'ultra', confidence: 'high' });
  assert.deepEqual(TokenTracker.resolvePlan({ badgePlan: null, modelPlan: 'free', storedPlan: 'pro' }), { plan: 'pro', confidence: 'stored' });
  assert.deepEqual(TokenTracker.resolvePlan({ badgePlan: null, modelPlan: 'pro', storedPlan: 'free' }), { plan: 'pro', confidence: 'model' });
  assert.deepEqual(TokenTracker.resolvePlan({ badgePlan: null, modelPlan: null, storedPlan: null }), { plan: 'free', confidence: 'default' });

  // Dead local compute-unit heuristic exports must stay deleted.
  for (const dead of ['DAY_MS', 'WEEK_MS', 'MAX_CONV_ENTRIES', 'DAILY_BASE_UNITS', 'WEEKLY_BASE_UNITS', 'MODEL_WEIGHTS', 'detectModelWeight', 'extractConversationId', 'recordConversationUsage', 'computeRemainingLevel']) {
    assert.equal(TokenTracker[dead], undefined, 'dead symbol still exported: ' + dead);
  }
  assert.equal(TokenTracker.PLAN_SPECS.pro.dailyBudget, undefined);
});

check('token-tracker: parseResetTimestamp ID/EN dot-time, 12h noon ambiguity, midnight & year wrap', () => {
  const noon = new Date(2026, 10, 20, 12, 34, 0, 0).getTime();
  const resNoon = TokenTracker.parseResetTimestamp('Direset pukul 3.42', noon, '5h');
  const dNoon = new Date(resNoon);
  assert.equal(dNoon.getDate(), 20);
  assert.equal(dNoon.getHours(), 15);
  assert.equal(dNoon.getMinutes(), 42);

  const night = new Date(2026, 10, 20, 23, 30, 0, 0).getTime();
  const resNight = TokenTracker.parseResetTimestamp('Direset pukul 3.42', night, '5h');
  const dNight = new Date(resNight);
  assert.equal(dNight.getDate(), 21);
  assert.equal(dNight.getHours(), 3);
  assert.equal(dNight.getMinutes(), 42);

  const res24 = TokenTracker.parseResetTimestamp('Direset pada 24 Nov pukul 13.42', noon, 'weekly');
  const d24 = new Date(res24);
  assert.equal(d24.getMonth(), 10);
  assert.equal(d24.getDate(), 24);
  assert.equal(d24.getHours(), 13);
  assert.equal(d24.getMinutes(), 42);

  const decLate = new Date(2026, 11, 30, 10, 0, 0, 0).getTime();
  const resJan = TokenTracker.parseResetTimestamp('Resets on Jan 4 at 9:00 AM', decLate, 'weekly');
  const dJan = new Date(resJan);
  assert.equal(dJan.getFullYear(), 2027);
  assert.equal(dJan.getMonth(), 0);
  assert.equal(dJan.getDate(), 4);
  assert.equal(dJan.getHours(), 9);

  const resRel = TokenTracker.parseResetTimestamp('Direset dalam 4 jam 12 menit', noon, '5h');
  assert.equal(resRel, noon + (4 * 60 + 12) * 60000);
});

check('token-tracker: parseUsagePageText ID & EN official /usage layouts + upsell immunity', () => {
  const noon = new Date(2026, 10, 20, 12, 34, 0, 0).getTime();
  const idText = [
    'Batas penggunaan',
    'PRO',
    'Penggunaan saat ini',
    'info',
    '12% digunakan',
    'Direset pukul 3.42',
    'Batas mingguan',
    'Direset pada 24 Nov pukul 13.42',
    '7% digunakan',
    'Dapatkan penggunaan 5x lebih banyak dengan AI Ultra',
    'Upgrade'
  ].join('\n');
  const parsedId = TokenTracker.parseUsagePageText(idText, noon);
  assert.equal(parsedId.detectedPlan, 'pro', 'must ignore upsell AI Ultra / Upgrade');
  assert.equal(parsedId.window5hPct, 12);
  assert.equal(parsedId.weeklyPct, 7);
  assert.equal(new Date(parsedId.window5hResetAt).getHours(), 15);
  assert.equal(new Date(parsedId.weeklyResetAt).getDate(), 24);

  const enText = [
    'Usage limits',
    'AI Pro',
    'Current usage',
    '12% used',
    'Resets at 3:42 PM',
    'Weekly limit',
    'Resets on Nov 24 at 1:42 PM',
    '7% used',
    'Get 5x more usage with AI Ultra',
    'Upgrade'
  ].join('\n');
  const parsedEn = TokenTracker.parseUsagePageText(enText, noon);
  assert.equal(parsedEn.detectedPlan, 'pro');
  assert.equal(parsedEn.window5hPct, 12);
  assert.equal(parsedEn.weeklyPct, 7);
  assert.equal(new Date(parsedEn.window5hResetAt).getHours(), 15);
  assert.equal(new Date(parsedEn.weeklyResetAt).getHours(), 13);

  const leftText = 'Usage limits\nFree\nCurrent usage\n88% left\nResets in 2 hours\nWeekly limit\n93% remaining\n';
  const parsedLeft = TokenTracker.parseUsagePageText(leftText, noon);
  assert.equal(parsedLeft.detectedPlan, 'free');
  assert.equal(parsedLeft.window5hPct, 12);
  assert.equal(parsedLeft.weeklyPct, 7);

  const idleText = 'Usage limits\nAI Plus\nCurrent usage\n0% used\nWeekly limit\n0% used';
  const parsedIdle = TokenTracker.parseUsagePageText(idleText, noon);
  assert.equal(parsedIdle.detectedPlan, 'plus');
  assert.equal(parsedIdle.window5hPct, 0);
  assert.equal(parsedIdle.window5hResetAt, 0);
  assert.equal(parsedIdle.weeklyPct, 0);
});

check('token-tracker: unsynced/synced snapshots, local expiry reset, uniform % used levels & limit guard', () => {
  assert.equal(TokenTracker.computeTierLevel(0.50), 'normal');
  assert.equal(TokenTracker.computeTierLevel(0.51), 'warn');
  assert.equal(TokenTracker.computeTierLevel(0.80), 'warn');
  assert.equal(TokenTracker.computeTierLevel(0.81), 'crit');
  assert.equal(TokenTracker.formatSyncAge(15000), 'just now');
  assert.equal(TokenTracker.formatSyncAge(12 * 60000), '12m ago');
  assert.equal(TokenTracker.formatSyncAge(3 * 3600000), '3h ago');

  assert.equal(TokenTracker.detectLimitBannerText('Normal chat text about limits'), null);
  assert.deepEqual(TokenTracker.detectLimitBannerText('You reached your daily quota limit. Try again in 2 hrs.'), { scope: 'daily', resetHint: '2 hrs' });
  assert.deepEqual(TokenTracker.detectLimitBannerText('Weekly limit reached until 09:30 AM'), { scope: 'weekly', resetHint: '09:30 AM' });

  const now = 1_700_000_000_000;
  const unsynced = TokenTracker.computeQuotaSnapshot(null, { plan: 'pro', inputTokens: 4100, outputTokens: 8100, draftTokens: 200, hasMedia: true, now });
  assert.equal(unsynced.ctxText, '~12.4k / 1M (1.2%)');
  assert.equal(unsynced.window5hText, '5h ...');
  assert.equal(unsynced.weeklyText, 'Week ...');
  assert.equal(unsynced.tip5h, 'Syncing from /usage...');
  assert.equal(unsynced.planBadgeText, 'AI Pro \u00b7 1M');
  assert.equal(unsynced.footerText, 'Syncing official usage from gemini.google.com/usage...');

  const syncedStore = {
    detectedPlan: 'pro',
    planConfidence: 'high',
    syncedAt: now - 120000,
    window5hPct: 55,
    window5hResetAt: now + (3 * 60 + 8) * 60000,
    weeklyPct: 84,
    weeklyResetAt: now + (4 * 24 + 13) * 3600000
  };
  const synced = TokenTracker.computeQuotaSnapshot(syncedStore, { plan: 'pro', inputTokens: 1000, outputTokens: 2000, draftTokens: 0, now });
  assert.equal(synced.window5hText, '5h 55% (3h 8m)');
  assert.equal(synced.window5hLevel, 'warn');
  assert.equal(synced.weeklyText, 'Week 84% (4d 13h)');
  assert.equal(synced.weeklyLevel, 'crit');
  assert.ok(synced.tip5h.startsWith('55% used \u00b7 resets in 3h 8m'));
  assert.equal(synced.footerText, 'Synced from gemini.google.com/usage \u00b7 2m ago');

  // Local reset expiry flips expired window to 0% without network.
  const expired = TokenTracker.computeQuotaSnapshot(syncedStore, { plan: 'pro', inputTokens: 1000, outputTokens: 0, draftTokens: 0, now: syncedStore.window5hResetAt });
  assert.equal(expired.window5hText, '5h 0%');
  assert.equal(expired.window5hLevel, 'normal');
  assert.equal(expired.weeklyPct, 84);

  const hitSnap = TokenTracker.computeQuotaSnapshot(syncedStore, {
    plan: 'free', inputTokens: 1000, outputTokens: 0, draftTokens: 0,
    limitBanner: { scope: 'daily', resetHint: '1h' }, now
  });
  assert.equal(hitSnap.window5hPct, 100);
  assert.equal(hitSnap.window5hLevel, 'crit');

  assert.equal(typeof Selectors.findComposerInput, 'function');
  assert.equal(typeof Selectors.findDisclaimer, 'function');
  assert.equal(typeof Selectors.isVisible, 'function');
  assert.ok(Array.isArray(Selectors.SEL.disclaimer) && Selectors.SEL.disclaimer.includes('.disclaimer-container'));
  assert.ok(Array.isArray(Selectors.SEL.planBadge));

  // findDisclaimer finds sibling disclaimer outside input-area-v2 while skipping chat-history prose
  const mkDiscNode = (text, opts = {}) => ({
    textContent: text,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    closest: (s) => (opts.inChat && s.includes('.chat-history') ? {} : null),
    querySelector: () => null
  });
  const chatDisc = mkDiscNode('Gemini adalah AI dan dapat membuat kesalahan.', { inChat: true });
  const realDisc = mkDiscNode('Gemini adalah AI dan dapat membuat kesalahan.');
  const mockDiscDoc = {
    querySelector: (s) => (s === '.bottom-container' ? { querySelectorAll: () => [chatDisc, realDisc] } : null),
    querySelectorAll: () => []
  };
  const foundDisc = Selectors.findDisclaimer(mockDiscDoc);
  assert.equal(foundDisc, realDisc);
  assert.equal(realDisc.attrs['data-gopt-disclaimer'], '1');
  assert.equal(chatDisc.attrs['data-gopt-disclaimer'], undefined);

  assert.ok(overlay.includes('--gopt-warn') && overlay.includes('--gopt-crit'));
  assert.ok(/html\.gopt-active\.gopt-token-bar-active/.test(overlay) && /visibility:\s*hidden !important/.test(overlay));
  assert.ok(overlay.includes('.disclaimer-container'));
  assert.ok(/\.gopt-token-bar\s*\{[^}]*bottom:\s*4px;[^}]*z-index:\s*2147482900;[^}]*justify-content:\s*flex-start;/s.test(overlay));
  assert.ok(/\.gopt-tk-meter\s*\{[^}]*flex:\s*1 1 64px;[^}]*height:\s*10px;/s.test(overlay));
  assert.ok(/\.gopt-tk-fill\s*\{/.test(overlay) && /\.gopt-token-tooltip\s*\{/.test(overlay));

  const tkSrc = read('src', 'content', 'token-tracker.js');
  assert.ok(tkSrc.includes("style.bottom = bottomPx + 'px'") && !tkSrc.includes('= cr.bottom - barH'));
  assert.ok(tkSrc.includes("addEventListener('resize', schedulePlace") && tkSrc.includes("removeEventListener('resize', schedulePlace"));
  assert.ok(tkSrc.includes('Svc.SEL.sidenav'));

  const main = read('src', 'content', 'main.js');
  assert.ok(main.includes('GeminiOptTokenTracker') && main.includes('TokenTracker.mount(document)'));
  assert.ok(main.includes('TokenTracker.resetRoute()') && main.includes('TokenTracker.destroy()'));
  assert.ok(main.includes('TokenTracker.startSmoothTrack('));
});

await checkAsync('usage-sync: controller single-flight, throttle, manual-tab protection, loop guard & SW removal', async () => {
  let fakeNow = 100000;
  let nextTabId = 42;
  const createdTabs = [];
  const removedTabs = [];
  const memLocal = {};
  const memSession = {};
  const timers = new Map();
  let nextTimerId = 1;

  const ctrl = UsageSync.createSyncController({
    tabs: {
      create: async (opts) => { const t = { id: nextTabId++, url: opts.url, active: opts.active }; createdTabs.push(t); return t; },
      remove: async (id) => { removedTabs.push(id); }
    },
    storage: {
      local: {
        get: async (k) => ({ [k]: memLocal[k] }),
        set: async (obj) => { Object.assign(memLocal, obj); }
      },
      session: {
        get: async (k) => ({ [k]: memSession[k] }),
        set: async (obj) => { Object.assign(memSession, obj); },
        remove: async (k) => { delete memSession[k]; }
      }
    },
    setTimeout: (fn) => { const id = nextTimerId++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    now: () => fakeNow
  });

  // Infinite-loop guard ignores TRIGGER_USAGE_SYNC from /usage tab
  let ignoredReply = null;
  ctrl.handleMessage({ type: 'TRIGGER_USAGE_SYNC', reason: 'chat' }, { tab: { id: 9, url: 'https://gemini.google.com/usage' } }, (r) => { ignoredReply = r; });
  assert.deepEqual(ignoredReply, { ok: false, ignored: true });
  assert.equal(createdTabs.length, 0);

  // Trigger sync -> single-flight blocks 2nd concurrent trigger
  const r1 = await ctrl.triggerUsageSync('initial');
  assert.deepEqual(r1, { started: true, tabId: 42 });
  assert.equal(ctrl.getState().inFlightTabId, 42);
  const r2 = await ctrl.triggerUsageSync('chat');
  assert.deepEqual(r2, { started: false, reason: 'IN_FLIGHT' });

  // Result from user's manual /usage tab (tab 99, isAutoSync: false) must NEVER close tab 99
  await new Promise((resolve) => {
    ctrl.handleMessage({
      type: 'USAGE_SYNC_RESULT',
      isAutoSync: false,
      data: { detectedPlan: 'pro', syncedAt: fakeNow, window5hPct: 12, window5hResetAt: fakeNow + 1000, weeklyPct: 7, weeklyResetAt: fakeNow + 5000 }
    }, { tab: { id: 99, url: 'https://gemini.google.com/usage' } }, (res) => {
      assert.equal(res.closed, false);
      resolve();
    });
  });
  assert.ok(!removedTabs.includes(99), 'must never close user manual /usage tab');
  assert.equal(memLocal[UsageSync.STORAGE_KEY].window5hPct, 12);

  // Result from our in-flight tab (tab 42, isAutoSync: true) MUST auto-close tab 42 and clear lock
  await new Promise((resolve) => {
    ctrl.handleMessage({
      type: 'USAGE_SYNC_RESULT',
      isAutoSync: true,
      data: { detectedPlan: null, syncedAt: fakeNow + 50, window5hPct: 15, window5hResetAt: fakeNow + 2000, weeklyPct: 8, weeklyResetAt: fakeNow + 6000 }
    }, { tab: { id: 42, url: 'https://gemini.google.com/usage#gopt-sync' } }, (res) => {
      assert.equal(res.closed, true);
      resolve();
    });
  });
  assert.ok(removedTabs.includes(42), 'auto-sync tab must close');
  assert.equal(ctrl.getState().inFlightTabId, null);
  assert.equal(memLocal[UsageSync.STORAGE_KEY].detectedPlan, 'pro', 'null plan preserves existing plan');

  // Throttle blocks immediate chat trigger (< 4000ms), but 'install' bypasses
  fakeNow += 1000;
  const rThrot = await ctrl.triggerUsageSync('response');
  assert.deepEqual(rThrot, { started: false, reason: 'THROTTLED' });
  const rInstall = await ctrl.triggerUsageSync('install');
  assert.deepEqual(rInstall, { started: true, tabId: 43 });

  // Timeout closes tab 43 & onTabRemoved releases lock cleanly
  const rTo = timers.get([...timers.keys()][0]);
  if (rTo) await rTo();
  assert.ok(removedTabs.includes(43));
  assert.equal(ctrl.getState().inFlightTabId, null);

  fakeNow += 5000;
  const r3 = await ctrl.triggerUsageSync('response');
  assert.equal(r3.tabId, 44);
  ctrl.onTabRemoved(44);
  assert.equal(ctrl.getState().inFlightTabId, null);
});

check('token-tracker: end-to-end mount + update + chrome.storage.onChanged live /usage sync', () => {
  const prevSel = globalThis.GeminiOptSelectors;
  const prevChrome = globalThis.chrome;
  const prevLoc = globalThis.location;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancelRaf = globalThis.cancelAnimationFrame;
  const prevW = globalThis.innerWidth;
  const prevH = globalThis.innerHeight;
  const prevAdd = globalThis.addEventListener;
  const prevRem = globalThis.removeEventListener;

  function mkClassList() {
    const set = new Set();
    return {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      contains: (c) => set.has(c),
      toggle: (c, on) => {
        const next = on === undefined ? !set.has(c) : !!on;
        if (next) set.add(c); else set.delete(c);
        return next;
      }
    };
  }
  function mkEl(tag) {
    const attrs = {};
    const children = [];
    return {
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      classList: mkClassList(),
      style: {},
      textContent: '',
      hidden: false,
      children,
      appendChild(c) { children.push(c); return c; },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      addEventListener() {},
      removeEventListener() {},
      remove() {},
      getBoundingClientRect: () => ({ left: 200, top: 770, width: 700, height: 22, bottom: 792 })
    };
  }

  const bodyChildren = [];
  const modelBtn = { textContent: 'Hydrogen Tinggi', getClientRects: () => [{}], getAttribute: () => null };
  const sidenavPro = { textContent: 'Pro', childElementCount: 0, closest: () => null };
  const disclaimerEl = {
    textContent: 'Gemini adalah AI dan dapat membuat kesalahan.',
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    closest: () => null,
    querySelector: () => null,
    getBoundingClientRect: () => ({ left: 300, top: 772, width: 500, height: 18, bottom: 790 })
  };
  const composerBox = { getBoundingClientRect: () => ({ left: 260, top: 700, width: 731, height: 56, bottom: 756 }) };
  const composerAnchor = {
    querySelector: (s) => (s.includes('.text-input-field') || s.includes('rich-textarea') ? composerBox : null),
    getBoundingClientRect: () => ({ left: 216, top: 700, width: 849, height: 56, bottom: 756 })
  };
  const mockDoc = {
    documentElement: { classList: mkClassList() },
    body: { appendChild: (el) => { bodyChildren.push(el); return el; } },
    createElement: (tag) => mkEl(tag),
    querySelector: (s) => {
      if (s === 'input-area-v2') return composerAnchor;
      if (s === 'bard-sidenav') return { querySelectorAll: () => [sidenavPro] };
      if (s === '.bottom-container') return { querySelectorAll: () => [disclaimerEl] };
      return null;
    },
    querySelectorAll: (s) => {
      if (s === '[data-test-id="bard-mode-menu-button"]') return [modelBtn];
      return [];
    }
  };
  const turnEl = {
    querySelector: (s) => {
      if (s === 'user-query') return { textContent: 'Jelaskan cara kerja baterai lithium ion modern' };
      if (s === 'model-response') return { textContent: 'Baterai lithium-ion bekerja dengan memindahkan ion litium antara katoda dan anoda melalui elektrolit.' };
      return null;
    }
  };

  let storageChangedCb = null;
  const sentMessages = [];
  const storeMem = {};

  try {
    globalThis.GeminiOptSelectors = Selectors;
    globalThis.chrome = {
      runtime: {
        lastError: null,
        sendMessage: (m, cb) => { sentMessages.push(m); if (cb) cb(); }
      },
      storage: {
        local: {
          get: (k, cb) => cb({ [k]: storeMem[k] }),
          set: (obj, cb) => { Object.assign(storeMem, obj); if (cb) cb(); }
        },
        onChanged: {
          addListener: (fn) => { storageChangedCb = fn; },
          removeListener: () => { storageChangedCb = null; }
        }
      }
    };
    globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
    globalThis.cancelAnimationFrame = () => {};
    globalThis.innerWidth = 1280;
    globalThis.innerHeight = 800;
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};

    TokenTracker.setEnabled(true);
    TokenTracker.mount(mockDoc);
    TokenTracker.update({
      turns: [turnEl],
      streaming: false,
      wasStreaming: false,
      url: 'https://gemini.google.com/app/test123',
      doc: mockDoc
    });

    assert.ok(sentMessages.some((m) => m.type === 'TRIGGER_USAGE_SYNC' && m.reason === 'initial'), 'triggers initial sync when syncedAt === 0');
    const bar = bodyChildren.find((n) => n.className === 'gopt-token-bar');
    assert.ok(bar, 'bar mounted in document.body');
    assert.ok(bar.classList.contains('is-visible'), 'bar must become visible');
    assert.ok(mockDoc.documentElement.classList.contains('gopt-token-bar-active'), 'html flag active');
    assert.equal(disclaimerEl.attrs['data-gopt-disclaimer'], '1', 'disclaimer stamped');
    assert.equal(bar.style.left, '260px');
    assert.equal(bar.style.width, '731px');
    assert.equal(bar.style.bottom, '8px');
    assert.equal(bar.style.top, '');

    const ctxSpan = bar.children.find((c) => c.className === 'gopt-tk-ctx');
    const span5h = bar.children.find((c) => c.className === 'gopt-tk-day');
    const spanWeek = bar.children.find((c) => c.className === 'gopt-tk-week');
    assert.ok(ctxSpan && ctxSpan.textContent.includes('/ 1M'), 'auto-detected AI Pro 1M cap: ' + (ctxSpan && ctxSpan.textContent));
    assert.equal(span5h.textContent, '5h ...');
    assert.equal(spanWeek.textContent, 'Week ...');
    assert.equal(bar.children[bar.children.length - 1].className, 'gopt-tk-meter', 'meter sits on right edge after left-aligned text');

    // Simulate background /usage sync arriving via chrome.storage.onChanged
    const now = Date.now();
    storageChangedCb({
      [TokenTracker.STORAGE_KEY]: {
        newValue: {
          detectedPlan: 'pro',
          planConfidence: 'high',
          syncedAt: now,
          window5hPct: 12,
          window5hResetAt: now + 3 * 3600000 + 8 * 60000,
          weeklyPct: 7,
          weeklyResetAt: now + (4 * 24 + 13) * 3600000
        }
      }
    }, 'local');
    assert.ok(span5h.textContent.startsWith('5h 12%'), 'synced 5h bar text: ' + span5h.textContent);
    assert.ok(spanWeek.textContent.startsWith('Week 7%'), 'synced weekly bar text: ' + spanWeek.textContent);

    // Regression: fast 1-answer reply (even without wasStreaming: true) and 1-word answer after prompt must trigger 'response' sync;
    // prepending older turns at top & storageListener updates must NOT trigger spurious syncs.
    const prevSetTo = globalThis.setTimeout;
    const prevClrTo = globalThis.clearTimeout;
    const fakeTimers = new Map();
    let tid = 1;
    globalThis.setTimeout = (fn, ms) => { const id = tid++; fakeTimers.set(id, { fn, ms }); return id; };
    globalThis.clearTimeout = (id) => { fakeTimers.delete(id); };
    try {
      sentMessages.length = 0;
      const olderTurn = {
        querySelector: (s) => (s === 'user-query' ? { textContent: 'Old q' } : s === 'model-response' ? { textContent: 'Old answer text here' } : null)
      };
      // Prepending older history at top keeps lastTurnEl unchanged -> 0 syncs
      TokenTracker.update({ turns: [olderTurn, turnEl], streaming: false, wasStreaming: false, url: 'https://gemini.google.com/app/test123', doc: mockDoc });
      for (const [, t] of fakeTimers) t.fn();
      fakeTimers.clear();
      assert.equal(sentMessages.filter((m) => m.reason === 'response').length, 0, 'prepending older turns must not trigger sync');

      // New prompt mounted first with empty model-response, then 1-word answer arrives without wasStreaming: true -> triggers sync!
      let replyText = '';
      const newTurn = {
        querySelector: (s) => (s === 'user-query' ? { textContent: 'Tes 1' } : s === 'model-response' ? { textContent: replyText } : null)
      };
      TokenTracker.update({ turns: [olderTurn, turnEl, newTurn], streaming: false, wasStreaming: false, url: 'https://gemini.google.com/app/test123', doc: mockDoc });
      for (const [, t] of fakeTimers) t.fn();
      fakeTimers.clear();
      assert.equal(sentMessages.filter((m) => m.reason === 'response').length, 0, 'empty model-response waits for answer');

      replyText = 'Ya';
      TokenTracker.update({ turns: [olderTurn, turnEl, newTurn], streaming: false, wasStreaming: false, url: 'https://gemini.google.com/app/test123', doc: mockDoc });
      assert.ok(fakeTimers.size >= 1, 'schedules post-answer settle sync after 1-word reply');
      for (const [, t] of fakeTimers) t.fn();
      fakeTimers.clear();
      assert.equal(sentMessages.filter((m) => m.reason === 'response').length, 1, 'triggers exactly 1 response sync after Gemini answers');

      // Storage update arriving afterwards must NOT replay wasStreaming or trigger another response sync
      sentMessages.length = 0;
      storageChangedCb({
        [TokenTracker.STORAGE_KEY]: {
          newValue: { detectedPlan: 'pro', planConfidence: 'high', syncedAt: now + 5000, window5hPct: 14, window5hResetAt: now + 3 * 3600000, weeklyPct: 8, weeklyResetAt: now + 4 * 24 * 3600000 }
        }
      }, 'local');
      for (const [, t] of fakeTimers) t.fn();
      fakeTimers.clear();
      assert.equal(sentMessages.filter((m) => m.reason === 'response').length, 0, 'storage update must not re-trigger response sync');
      assert.ok(span5h.textContent.startsWith('5h 14%'), 'bar updates to new synced 14%: ' + span5h.textContent);

      // Regression: switching conversations (Convo A -> empty loading shell -> Convo B hydrated, even multi-wave) must NOT trigger /usage sync
      sentMessages.length = 0;
      globalThis.location = { pathname: '/app/other456', hash: '', href: 'https://gemini.google.com/app/other456' };
      TokenTracker.resetRoute();
      TokenTracker.update({ turns: [], streaming: false, wasStreaming: false, url: 'https://gemini.google.com/app/other456', doc: mockDoc });
      const bTurn1 = { querySelector: (s) => (s === 'user-query' ? { textContent: 'B q1' } : s === 'model-response' ? { textContent: 'B answer 1 full text' } : null) };
      const bTurn2 = { querySelector: (s) => (s === 'user-query' ? { textContent: 'B q2' } : s === 'model-response' ? { textContent: 'B answer 2 full text' } : null) };
      TokenTracker.update({ turns: [bTurn1], streaming: false, wasStreaming: false, url: 'https://gemini.google.com/app/other456', doc: mockDoc });
      TokenTracker.update({ turns: [bTurn1, bTurn2], streaming: false, wasStreaming: false, url: 'https://gemini.google.com/app/other456', doc: mockDoc });
      for (const [, t] of fakeTimers) t.fn();
      fakeTimers.clear();
      assert.equal(sentMessages.filter((m) => m.reason === 'response').length, 0, 'switching conversations must NOT trigger /usage sync');

      // Regression: navigating from bare /app Home without typing a prompt to an existing convo must NOT trigger sync
      globalThis.location = { pathname: '/app', hash: '', href: 'https://gemini.google.com/app' };
      TokenTracker.resetRoute();
      TokenTracker.update({ turns: [], streaming: false, wasStreaming: false, url: 'https://gemini.google.com/app', doc: mockDoc });
      globalThis.location = { pathname: '/app/existing789', hash: '', href: 'https://gemini.google.com/app/existing789' };
      TokenTracker.resetRoute();
      TokenTracker.update({ turns: [bTurn1, bTurn2], streaming: false, wasStreaming: false, url: 'https://gemini.google.com/app/existing789', doc: mockDoc });
      for (const [, t] of fakeTimers) t.fn();
      fakeTimers.clear();
      assert.equal(sentMessages.filter((m) => m.reason === 'response').length, 0, 'opening existing chat from Home without prompt must NOT trigger sync');
    } finally {
      globalThis.setTimeout = prevSetTo;
      globalThis.clearTimeout = prevClrTo;
    }

    const mainSrc = read('src', 'content', 'main.js');
    assert.ok(mainSrc.includes('STREAM_WATCH_MS') && mainSrc.includes('streamWatchTimer'), 'main.js polls while streaming so external stopButton removal is caught');
    TokenTracker.destroy();

    // Verify /usage scraper mode captures #gopt-sync immediately, skips bar UI, and posts USAGE_SYNC_RESULT
    sentMessages.length = 0;
    bodyChildren.length = 0;
    globalThis.location = { pathname: '/usage', hash: '#gopt-sync', href: 'https://gemini.google.com/usage#gopt-sync' };
    const usageContainer = {
      childNodes: [],
      textContent: 'Batas penggunaan\nPRO\nPenggunaan saat ini\n12% digunakan\nDireset pukul 15.42\nBatas mingguan\nDireset pada 24 Nov pukul 13.42\n7% digunakan\nDapatkan penggunaan 5x lebih banyak dengan AI Ultra\nUpgrade'
    };
    const usageDoc = {
      documentElement: { classList: mkClassList() },
      body: { appendChild: (el) => { bodyChildren.push(el); return el; } },
      querySelector: (s) => (s === 'bard-sidenav-content' ? usageContainer : null)
    };
    TokenTracker.mount(usageDoc);
    assert.equal(bodyChildren.length, 0, '/usage scraper must not mount token bar');
    const syncMsg = sentMessages.find((m) => m.type === 'USAGE_SYNC_RESULT');
    assert.ok(syncMsg && syncMsg.isAutoSync === true && syncMsg.data.detectedPlan === 'pro');
    assert.equal(syncMsg.data.window5hPct, 12);
    assert.equal(syncMsg.data.weeklyPct, 7);
    assert.equal(storeMem[TokenTracker.STORAGE_KEY].window5hPct, 12);
    TokenTracker.destroy();
  } finally {
    globalThis.GeminiOptSelectors = prevSel;
    globalThis.chrome = prevChrome;
    if (prevLoc !== undefined) globalThis.location = prevLoc;
    else delete globalThis.location;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancelRaf;
    globalThis.innerWidth = prevW;
    globalThis.innerHeight = prevH;
    globalThis.addEventListener = prevAdd;
    globalThis.removeEventListener = prevRem;
  }
});

// ---------- Reset-Time Engine, Provisional Anchor & 60fps LaTeX Optimizations ----------
check('token-tracker: candidate reset solver covers 12h/24h ambiguity, midnight rollover & exact minute match', () => {
  // 12.30 at 21:00 (no AM/PM) -> tomorrow 00:30 (+3h30m inside 5h15m window)
  const ninePm = new Date(2026, 10, 20, 21, 0, 0, 0).getTime();
  const r1230 = new Date(TokenTracker.parseResetTimestamp('Direset pukul 12.30', ninePm, '5h'));
  assert.equal(r1230.getDate(), 21);
  assert.equal(r1230.getHours(), 0);
  assert.equal(r1230.getMinutes(), 30);

  // Explicit 12:30 PM at 10:00 -> today 12:30 vs explicit 12:30 AM at 21:00 -> tomorrow 00:30
  const tenAm = new Date(2026, 10, 20, 10, 0, 0, 0).getTime();
  const r1230pm = new Date(TokenTracker.parseResetTimestamp('Resets at 12:30 PM', tenAm, '5h'));
  assert.equal(r1230pm.getDate(), 20);
  assert.equal(r1230pm.getHours(), 12);
  const r1230am = new Date(TokenTracker.parseResetTimestamp('Resets at 12:30 AM', ninePm, '5h'));
  assert.equal(r1230am.getDate(), 21);
  assert.equal(r1230am.getHours(), 0);

  // 00:05 at 23:59 rollover -> tomorrow 00:05 (+6m)
  const lateNight = new Date(2026, 10, 20, 23, 59, 0, 0).getTime();
  const r0005 = new Date(TokenTracker.parseResetTimestamp('Direset pukul 00.05', lateNight, '5h'));
  assert.equal(r0005.getDate(), 21);
  assert.equal(r0005.getHours(), 0);
  assert.equal(r0005.getMinutes(), 5);

  // Exact clock-minute match in (ts - 2m, ts] stays clamped at >= ts instead of jumping +24h
  const exactNow = new Date(2026, 10, 20, 15, 42, 30, 0).getTime();
  const rExact = TokenTracker.parseResetTimestamp('Direset pukul 15.42', exactNow, '5h');
  assert.equal(rExact, exactNow);
});

await checkAsync('provisional reset anchor, snapshot formatting & usage-sync snap/preserve/manual bypass', async () => {
  assert.equal(TokenTracker.WINDOW_5H_MS, 5 * 3600 * 1000);
  assert.equal(TokenTracker.WINDOW_WEEK_MS, 7 * 24 * 3600 * 1000);

  const t0 = 1_700_000_000_000;
  const prov = TokenTracker.applyProvisionalReset(null, t0);
  assert.equal(prov.window5hPct, 0);
  assert.equal(prov.window5hResetAt, t0 + TokenTracker.WINDOW_5H_MS);
  assert.equal(prov.window5hResetProvisional, true);
  assert.equal(prov.weeklyPct, 0);
  assert.equal(prov.weeklyResetAt, t0 + TokenTracker.WINDOW_WEEK_MS);
  assert.equal(prov.weeklyResetProvisional, true);

  const snap = TokenTracker.computeQuotaSnapshot(prov, { plan: 'pro', inputTokens: 100, outputTokens: 200, now: t0 });
  assert.equal(snap.window5hText, '5h 0% (~5h 0m)');
  assert.equal(snap.weeklyText, 'Week 0% (~7d 0h)');
  assert.equal(snap.window5hResetProvisional, true);
  assert.equal(snap.weeklyResetProvisional, true);
  assert.ok(snap.tip5h.includes('~5h 0m') && snap.tip5h.includes('(provisional)'));
  assert.ok(snap.tipWeekly.includes('~7d 0h') && snap.tipWeekly.includes('(provisional)'));

  // Preserves active/provisional reset when scraped ResetAt === 0; snaps official ResetAt > 0
  let fakeNow = t0;
  let nextTabId = 90;
  const memLocal = {
    [UsageSync.STORAGE_KEY]: {
      detectedPlan: 'pro',
      planConfidence: 'high',
      syncedAt: 0,
      window5hPct: 0,
      window5hResetAt: t0 + TokenTracker.WINDOW_5H_MS,
      window5hResetProvisional: true,
      weeklyPct: 5,
      weeklyResetAt: t0 + TokenTracker.WINDOW_WEEK_MS,
      weeklyResetProvisional: false
    }
  };
  const ctrl = UsageSync.createSyncController({
    tabs: { create: async (opts) => ({ id: nextTabId++, url: opts.url }), remove: async () => {} },
    storage: {
      local: { get: async (k) => ({ [k]: memLocal[k] }), set: async (o) => Object.assign(memLocal, o) },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    now: () => fakeNow
  });

  await ctrl.saveSyncedUsage({
    detectedPlan: 'pro', syncedAt: fakeNow + 1000,
    window5hPct: 0, window5hResetAt: 0, weeklyPct: 5, weeklyResetAt: 0
  });
  assert.equal(memLocal[UsageSync.STORAGE_KEY].window5hResetAt, t0 + TokenTracker.WINDOW_5H_MS, 'preserves unexpired provisional 5h reset');
  assert.equal(memLocal[UsageSync.STORAGE_KEY].window5hResetProvisional, true);
  assert.equal(memLocal[UsageSync.STORAGE_KEY].weeklyResetAt, t0 + TokenTracker.WINDOW_WEEK_MS, 'preserves active >0% weekly reset');
  assert.equal(memLocal[UsageSync.STORAGE_KEY].weeklyResetProvisional, false);

  await ctrl.saveSyncedUsage({
    detectedPlan: 'pro', syncedAt: fakeNow + 2000,
    window5hPct: 3, window5hResetAt: fakeNow + 4 * 3600000, weeklyPct: 6, weeklyResetAt: fakeNow + 6 * 86400000
  });
  assert.equal(memLocal[UsageSync.STORAGE_KEY].window5hResetAt, fakeNow + 4 * 3600000);
  assert.equal(memLocal[UsageSync.STORAGE_KEY].window5hResetProvisional, false, 'official ResetAt clears provisional flag');

  // 'manual' bypasses MIN_SYNC_INTERVAL_MS throttle
  const rFirst = await ctrl.triggerUsageSync('response');
  assert.equal(rFirst.started, true);
  ctrl.onTabRemoved(rFirst.tabId);
  fakeNow += 500;
  assert.deepEqual(await ctrl.triggerUsageSync('response'), { started: false, reason: 'THROTTLED' });
  const rManual = await ctrl.triggerUsageSync('manual');
  assert.equal(rManual.started, true, 'manual sync bypasses throttle');
});

check('token-tracker: manual click/Enter sync, scroll-idle sync deferral, MathML dedup & settled-turn cache', () => {
  const prevSel = globalThis.GeminiOptSelectors;
  const prevChrome = globalThis.chrome;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancelRaf = globalThis.cancelAnimationFrame;
  const prevSetTo = globalThis.setTimeout;
  const prevClrTo = globalThis.clearTimeout;
  const prevW = globalThis.innerWidth;
  const prevH = globalThis.innerHeight;
  const prevAdd = globalThis.addEventListener;
  const prevRem = globalThis.removeEventListener;

  const mkClassList = () => {
    const set = new Set();
    return {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      contains: (c) => set.has(c),
      toggle: (c, on) => {
        const next = on === undefined ? !set.has(c) : !!on;
        if (next) set.add(c); else set.delete(c);
        return next;
      }
    };
  };
  let selectionStr = '';
  const mkEl = (tag) => {
    const attrs = {};
    const listeners = {};
    const children = [];
    return {
      tagName: tag.toUpperCase(), id: '', className: '', classList: mkClassList(),
      style: {}, textContent: '', hidden: false, children, attrs, listeners,
      appendChild(c) { children.push(c); return c; },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener() {},
      remove() {},
      getBoundingClientRect: () => ({ left: 200, top: 770, width: 700, height: 22, bottom: 792 })
    };
  };
  const bodyChildren = [];
  const sentMessages = [];
  const fakeTimers = new Map();
  let nextTid = 1;
  let storageChangedCb = null;
  let scrolling = false;
  let idleSubscriber = null;
  const storeMem = {};

  const mockDoc = {
    defaultView: { getSelection: () => selectionStr },
    documentElement: { classList: mkClassList() },
    body: { appendChild: (el) => { bodyChildren.push(el); return el; } },
    createElement: (tag) => mkEl(tag),
    querySelector: () => null,
    querySelectorAll: () => []
  };

  try {
    globalThis.GeminiOptSelectors = Selectors;
    globalThis.chrome = {
      runtime: { lastError: null, sendMessage: (m, cb) => { sentMessages.push(m); if (cb) cb(); } },
      storage: {
        local: { get: (k, cb) => cb({ [k]: storeMem[k] }), set: (o, cb) => { Object.assign(storeMem, o); if (cb) cb(); } },
        onChanged: { addListener: (fn) => { storageChangedCb = fn; }, removeListener: () => { storageChangedCb = null; } }
      }
    };
    globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
    globalThis.cancelAnimationFrame = () => {};
    globalThis.setTimeout = (fn, ms) => { const id = nextTid++; fakeTimers.set(id, { fn, ms }); return id; };
    globalThis.clearTimeout = (id) => { fakeTimers.delete(id); };
    globalThis.innerWidth = 1280;
    globalThis.innerHeight = 800;
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};

    let uReads = 0;
    let mReads = 0;
    const prose = 'Explanation about integral calculus and convergence. ';
    const mathml = '\\int_0^1 x^2 dx = 1/3';
    const rawTotal = prose + mathml.repeat(12) + ' '.repeat(12) + mathml.repeat(12);
    const katexNodes = Array.from({ length: 12 }, () => ({ textContent: mathml }));
    const uqObj = { get textContent() { uReads++; return 'Integrate x^2'; } };
    const mrObj = {
      childElementCount: 4,
      querySelectorAll: (s) => (s === '.katex-mathml' ? katexNodes : []),
      get textContent() { mReads++; return rawTotal; }
    };
    const mathTurn = {
      querySelector: (s) => (s === 'user-query' ? uqObj : s === 'model-response' ? mrObj : null)
    };

    let latestReply = 'Here is an initial summary.';
    const latestTurn = {
      querySelector: (s) => (s === 'user-query' ? { textContent: 'q-latest' } : s === 'model-response' ? {
        childElementCount: 1,
        get textContent() { return latestReply; }
      } : null)
    };

    TokenTracker.setEnabled(true);
    TokenTracker.setScrollStateProvider(() => scrolling, (cb) => { idleSubscriber = cb; return () => { idleSubscriber = null; }; });
    TokenTracker.mount(mockDoc);
    TokenTracker.update({ turns: [mathTurn, latestTurn], streaming: false, wasStreaming: false, url: 'https://gemini.google.com/app/m1', doc: mockDoc });
    assert.equal(uReads, 1);
    assert.equal(mReads, 1);

    // .katex-mathml deduplication cuts output estimate well below raw text estimate
    const tip = bodyChildren.find((n) => n.id === 'gopt-token-tooltip');
    const outRowBefore = tip.children[1].children[1].children[1].textContent;
    const parsedOutBefore = parseInt(outRowBefore.replace(/\D/g, ''), 10);
    assert.ok(parsedOutBefore < TokenTracker.estimateTokens(rawTotal + latestReply), 'deduplicated output ' + parsedOutBefore + ' < raw ' + TokenTracker.estimateTokens(rawTotal + latestReply));

    // Historical mathTurn hits settled cache (0 extra reads), while in-place edit on latestTurn updates tokens without childElementCount change
    latestReply = 'Here is an initial summary. Plus extra explanation!';
    TokenTracker.update({ turns: [mathTurn, latestTurn], streaming: false, wasStreaming: false, url: 'https://gemini.google.com/app/m1', doc: mockDoc });
    assert.equal(uReads, 1, 'historical settled turn skips userQuery textContent read');
    assert.equal(mReads, 1, 'historical settled turn skips modelResponse textContent read');
    const outRowAfter = tip.children[1].children[1].children[1].textContent;
    const parsedOutAfter = parseInt(outRowAfter.replace(/\D/g, ''), 10);
    assert.ok(parsedOutAfter > parsedOutBefore, 'in-place lastTurn edit updates output (' + parsedOutBefore + ' -> ' + parsedOutAfter + ')');

    // Verify role="button", click with selection ignored, click & Enter trigger manual sync + is-syncing UI
    const bar = bodyChildren.find((n) => n.className === 'gopt-token-bar');
    assert.equal(bar.attrs.role, 'button');
    assert.ok(bar.attrs['aria-label'].includes('sync'));

    // Initial answer completion in unsynced store anchors provisional 5h/weekly countdown (~5h 0m)
    const span5h = bar.children.find((c) => c.className === 'gopt-tk-day');
    assert.equal(span5h.textContent, '5h ...');
    const firstReplyTurn = {
      querySelector: (s) => (s === 'user-query' ? { textContent: 'q1' } : s === 'model-response' ? { textContent: 'first completed reply' } : null)
    };
    TokenTracker.update({ turns: [mathTurn, firstReplyTurn], streaming: false, wasStreaming: true, url: 'https://gemini.google.com/app/m1', doc: mockDoc });
    assert.ok(span5h.textContent.startsWith('5h 0% (~'), 'response completion anchors provisional 5h countdown: ' + span5h.textContent);
    fakeTimers.clear();

    sentMessages.length = 0;
    selectionStr = 'selected prose';
    bar.listeners.click[0]();
    assert.equal(sentMessages.length, 0, 'non-empty selection suppresses click sync');

    selectionStr = '';
    bar.listeners.click[0]();
    assert.equal(sentMessages.filter((m) => m.reason === 'manual').length, 1);
    assert.ok(bar.classList.contains('is-syncing'));
    assert.equal(tip.children[4].textContent, 'Syncing official usage...');

    // 16s manual sync safety timeout clears .is-syncing if no storage update arrives
    const cap16s = Array.from(fakeTimers.entries()).find(([, v]) => v.ms === 16000);
    assert.ok(cap16s, 'schedules 16s manual-sync safety timer');
    fakeTimers.delete(cap16s[0]);
    cap16s[1].fn();
    assert.ok(!bar.classList.contains('is-syncing'), '16s safety timer clears is-syncing');

    // Re-trigger via Space keydown and clear via chrome.storage.onChanged
    let spacePrevented = false;
    bar.listeners.keydown[0]({ key: ' ', preventDefault: () => { spacePrevented = true; } });
    assert.ok(spacePrevented && bar.classList.contains('is-syncing'));
    storageChangedCb({
      [TokenTracker.STORAGE_KEY]: {
        newValue: { detectedPlan: 'pro', planConfidence: 'high', syncedAt: Date.now(), window5hPct: 5, window5hResetAt: Date.now() + 3600000, weeklyPct: 1, weeklyResetAt: Date.now() + 86400000 }
      }
    }, 'local');
    assert.ok(!bar.classList.contains('is-syncing'), 'storage update clears is-syncing');

    let prevented = false;
    bar.listeners.keydown[0]({ key: 'Enter', preventDefault: () => { prevented = true; } });
    assert.ok(prevented && sentMessages.filter((m) => m.reason === 'manual').length === 3);

    // Scroll-aware post-answer sync: waits if scrolling when settle timer fires, then waits +500ms after idle
    sentMessages.length = 0;
    fakeTimers.clear();
    const newTurn = {
      querySelector: (s) => (s === 'user-query' ? { textContent: 'q2' } : s === 'model-response' ? { textContent: 'answer 2' } : null)
    };
    TokenTracker.update({ turns: [mathTurn, newTurn], streaming: false, wasStreaming: true, url: 'https://gemini.google.com/app/m1', doc: mockDoc });
    const settleEntry = Array.from(fakeTimers.entries()).find(([, v]) => v.ms === 1800);
    assert.ok(settleEntry, 'schedules 1800ms settle timer');
    scrolling = true;
    fakeTimers.delete(settleEntry[0]);
    settleEntry[1].fn();
    assert.equal(sentMessages.filter((m) => m.reason === 'response').length, 0, 'defers sync while user is scrolling');
    assert.ok(typeof idleSubscriber === 'function', 'subscribes to scroll idle');

    scrolling = false;
    idleSubscriber();
    const postIdleEntry = Array.from(fakeTimers.entries()).find(([, v]) => v.ms === 500);
    assert.ok(postIdleEntry, 'waits 500ms after scroll becomes idle');
    fakeTimers.delete(postIdleEntry[0]);
    postIdleEntry[1].fn();
    assert.equal(sentMessages.filter((m) => m.reason === 'response').length, 1, 'fires response sync after idle grace');

    // Continuous scroll past 6000ms max cap forces sync without starvation
    sentMessages.length = 0;
    fakeTimers.clear();
    const newTurn3 = {
      querySelector: (s) => (s === 'user-query' ? { textContent: 'q3' } : s === 'model-response' ? { textContent: 'answer 3' } : null)
    };
    TokenTracker.update({ turns: [mathTurn, newTurn3], streaming: false, wasStreaming: true, url: 'https://gemini.google.com/app/m1', doc: mockDoc });
    const settleEntry2 = Array.from(fakeTimers.entries()).find(([, v]) => v.ms === 1800);
    scrolling = true;
    fakeTimers.delete(settleEntry2[0]);
    settleEntry2[1].fn();
    const cap6s = Array.from(fakeTimers.entries()).find(([, v]) => v.ms === 6000);
    assert.ok(cap6s, 'schedules 6000ms max defer cap timer');
    fakeTimers.delete(cap6s[0]);
    cap6s[1].fn();
    assert.equal(sentMessages.filter((m) => m.reason === 'response').length, 1, '6000ms max cap flushes response sync during continuous scroll');
    TokenTracker.destroy();
  } finally {
    globalThis.GeminiOptSelectors = prevSel;
    globalThis.chrome = prevChrome;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancelRaf;
    globalThis.setTimeout = prevSetTo;
    globalThis.clearTimeout = prevClrTo;
    globalThis.innerWidth = prevW;
    globalThis.innerHeight = prevH;
    globalThis.addEventListener = prevAdd;
    globalThis.removeEventListener = prevRem;
  }
});

await checkAsync('end-to-end provisional persist -> manual click flush -> 0% /usage finishScrape preserve -> official reset snap', async () => {
  const prevSel = globalThis.GeminiOptSelectors;
  const prevChrome = globalThis.chrome;
  const prevLoc = globalThis.location;
  const prevRaf = globalThis.requestAnimationFrame;
  const prevCancelRaf = globalThis.cancelAnimationFrame;
  const prevSetTo = globalThis.setTimeout;
  const prevClrTo = globalThis.clearTimeout;
  const prevDateNow = Date.now;
  const prevW = globalThis.innerWidth;
  const prevH = globalThis.innerHeight;
  const prevAdd = globalThis.addEventListener;
  const prevRem = globalThis.removeEventListener;

  let fakeNow = new Date(2026, 10, 20, 12, 34, 0, 0).getTime();
  const mkClassList = () => {
    const set = new Set();
    return {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      contains: (c) => set.has(c),
      toggle: (c, on) => { const n = on === undefined ? !set.has(c) : !!on; if (n) set.add(c); else set.delete(c); return n; }
    };
  };
  const mkEl = (tag) => {
    const attrs = {}; const listeners = {}; const children = [];
    return {
      tagName: tag.toUpperCase(), id: '', className: '', classList: mkClassList(),
      style: {}, textContent: '', hidden: false, children, attrs, listeners,
      appendChild(c) { children.push(c); return c; },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener() {},
      remove() {},
      getBoundingClientRect: () => ({ left: 200, top: 770, width: 700, height: 22, bottom: 792 })
    };
  };

  const memLocal = {};
  let storageChangedCb = null;
  const bodyChildren = [];
  const fakeTimers = new Map();
  let nextTid = 1;
  let usagePageText = '';

  const ctrl = UsageSync.createSyncController({
    tabs: { create: async () => ({ id: 77 }), remove: async () => {} },
    storage: {
      local: { get: async (k) => ({ [k]: memLocal[k] }), set: async (o) => Object.assign(memLocal, o) },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    now: () => fakeNow
  });

  const mockDoc = {
    defaultView: { getSelection: () => '' },
    documentElement: { classList: mkClassList() },
    body: { appendChild: (el) => { bodyChildren.push(el); return el; } },
    createElement: (tag) => mkEl(tag),
    querySelector: (s) => (s === 'bard-sidenav-content' ? { childNodes: [], textContent: usagePageText } : null),
    querySelectorAll: () => []
  };

  let sentSyncMsgs = [];
  try {
    globalThis.GeminiOptSelectors = Selectors;
    Date.now = () => fakeNow;
    globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
    globalThis.cancelAnimationFrame = () => {};
    globalThis.setTimeout = (fn, ms) => { const id = nextTid++; fakeTimers.set(id, { fn, ms }); return id; };
    globalThis.clearTimeout = (id) => { fakeTimers.delete(id); };
    globalThis.innerWidth = 1280;
    globalThis.innerHeight = 800;
    globalThis.addEventListener = () => {};
    globalThis.removeEventListener = () => {};
    globalThis.chrome = {
      runtime: {
        lastError: null,
        sendMessage: (m, cb) => {
          sentSyncMsgs.push(m);
          if (cb) cb();
        }
      },
      storage: {
        local: {
          get: (k, cb) => cb({ [k]: memLocal[k] }),
          set: (o, cb) => { Object.assign(memLocal, o); if (cb) cb(); }
        },
        onChanged: {
          addListener: (fn) => { storageChangedCb = fn; },
          removeListener: () => { storageChangedCb = null; }
        }
      }
    };

    // 1. Answer completion on unsynced store anchors provisional reset, and manual click flushes 350ms timer immediately
    TokenTracker.setEnabled(true);
    TokenTracker.mount(mockDoc);
    const doneTurn = {
      querySelector: (s) => (s === 'user-query' ? { textContent: 'hello' } : s === 'model-response' ? { textContent: 'world' } : null)
    };
    TokenTracker.update({ turns: [doneTurn], streaming: false, wasStreaming: true, url: 'https://gemini.google.com/app/c1', doc: mockDoc });
    assert.equal(memLocal[TokenTracker.STORAGE_KEY], undefined, '350ms persist timer still pending before manual click');

    const bar = bodyChildren.find((n) => n.className === 'gopt-token-bar');
    bar.listeners.click[0]();
    assert.ok(sentSyncMsgs.some((m) => m.type === 'TRIGGER_USAGE_SYNC' && m.reason === 'manual'));
    const storedAfterFlush = memLocal[TokenTracker.STORAGE_KEY];
    const expectedProv5h = fakeNow + TokenTracker.WINDOW_5H_MS;
    assert.ok(storedAfterFlush && storedAfterFlush.window5hResetProvisional === true && storedAfterFlush.window5hResetAt === expectedProv5h,
      'manual click flushes provisional reset before /usage tab opens');
    TokenTracker.destroy();

    // 2. /usage#gopt-sync scrapes 0% with no reset line -> both finishScrape & saveSyncedUsage preserve unexpired provisional anchor
    fakeNow += 5000;
    sentSyncMsgs = [];
    usagePageText = 'Batas penggunaan\nPRO\nPenggunaan saat ini\n0% digunakan\nBatas mingguan\n0% digunakan';
    globalThis.location = { pathname: '/usage', hash: '#gopt-sync', href: 'https://gemini.google.com/usage#gopt-sync' };
    TokenTracker.mount(mockDoc);
    assert.equal(memLocal[TokenTracker.STORAGE_KEY].window5hResetAt, expectedProv5h, 'finishScrape preserves unexpired provisional 5h reset');
    assert.equal(memLocal[TokenTracker.STORAGE_KEY].window5hResetProvisional, true);
    const scrapeMsg1 = sentSyncMsgs.find((m) => m.type === 'USAGE_SYNC_RESULT');
    assert.ok(scrapeMsg1);
    await new Promise((resolve) => {
      ctrl.handleMessage(scrapeMsg1, { tab: { id: 77, url: globalThis.location.href } }, resolve);
    });
    assert.equal(memLocal[UsageSync.STORAGE_KEY].window5hResetAt, expectedProv5h, 'saveSyncedUsage preserves provisional 5h reset');
    assert.equal(memLocal[UsageSync.STORAGE_KEY].window5hResetProvisional, true);
    TokenTracker.destroy();

    // 3. Subsequent /usage scrape prints official "Direset pukul 15.42" -> snaps cleanly & clears provisional flag
    fakeNow += 10000;
    sentSyncMsgs = [];
    usagePageText = 'Batas penggunaan\nPRO\nPenggunaan saat ini\n12% digunakan\nDireset pukul 15.42\nBatas mingguan\n3% digunakan\nDireset pada 24 Nov pukul 13.42';
    TokenTracker.mount(mockDoc);
    const officialExpected = new Date(2026, 10, 20, 15, 42, 0, 0).getTime();
    assert.equal(memLocal[TokenTracker.STORAGE_KEY].window5hResetAt, officialExpected, 'finishScrape snaps to official 15:42 reset');
    assert.equal(memLocal[TokenTracker.STORAGE_KEY].window5hResetProvisional, false);
    const scrapeMsg2 = sentSyncMsgs.find((m) => m.type === 'USAGE_SYNC_RESULT');
    await new Promise((resolve) => {
      ctrl.handleMessage(scrapeMsg2, { tab: { id: 77, url: globalThis.location.href } }, resolve);
    });
    assert.equal(memLocal[UsageSync.STORAGE_KEY].window5hPct, 12);
    assert.equal(memLocal[UsageSync.STORAGE_KEY].window5hResetAt, officialExpected);
    assert.equal(memLocal[UsageSync.STORAGE_KEY].window5hResetProvisional, false);
    TokenTracker.destroy();
  } finally {
    Date.now = prevDateNow;
    globalThis.GeminiOptSelectors = prevSel;
    globalThis.chrome = prevChrome;
    if (prevLoc !== undefined) globalThis.location = prevLoc;
    else delete globalThis.location;
    globalThis.requestAnimationFrame = prevRaf;
    globalThis.cancelAnimationFrame = prevCancelRaf;
    globalThis.setTimeout = prevSetTo;
    globalThis.clearTimeout = prevClrTo;
    globalThis.innerWidth = prevW;
    globalThis.innerHeight = prevH;
    globalThis.addEventListener = prevAdd;
    globalThis.removeEventListener = prevRem;
  }
});

check('selectors & 60fps LaTeX CSS/JS contracts: KaTeX skip, virtualization, light-render zero-*, shield & Auto-Guard', () => {
  for (const s of ['.katex', '.katex-display', '.katex-html', '.katex-mathml', '.math-inline', '.math-block', 'math-inline', 'math-block']) {
    assert.ok(Selectors.SEL.protected.includes(s), 'missing protected math selector: ' + s);
  }
  const katexCand = {
    tagName: 'SPAN', textContent: 'Sources', childElementCount: 0, attrs: {},
    getAttribute: () => '', setAttribute(k, v) { this.attrs[k] = v; },
    closest: (s) => (s.includes('.katex') ? {} : null),
    querySelector: () => null
  };
  const streamingResp = {
    textContent: 'Using info from Drive',
    getAttribute: (k) => (k === 'aria-busy' ? 'true' : null),
    querySelectorAll: () => [mockCandidate({ text: 'Menggunakan info dari Drive' })]
  };
  const mrRoot = {
    querySelectorAll: () => [{ textContent: 'math response', querySelectorAll: () => [katexCand] }]
  };
  assert.equal(Selectors.tagDynamicAttributionNodes({ querySelectorAll: (s) => (s === 'model-response' ? mrRoot.querySelectorAll() : []) }), 0);
  assert.equal(Selectors.tagDynamicAttributionNodes({ querySelectorAll: (s) => (s === 'model-response' ? [streamingResp] : []) }), 0);

  const earlyCss = read('src', 'content', 'early-perf.css');
  assert.ok(earlyCss.includes('content-visibility: auto') && earlyCss.includes('overflow-clip-margin: 12px'));
  assert.ok(/html\.gopt-lite-latex\s+\.katex-mathml\s*\{\s*display:\s*none !important/.test(earlyCss));
  assert.ok(/\[data-gopt-scrolling="1"\]\s*:is\(\.markdown,\s*\.markdown-main-panel\)/.test(earlyCss));
  assert.ok(/html\.gopt-width-animating:not\(\.gopt-latex-heavy\)/.test(earlyCss));

  const lightSection = overlay.slice(overlay.indexOf('html.gopt-light-render'), overlay.indexOf('/* ---------- text optimization'));
  assert.ok(!lightSection.includes('*'), 'gopt-light-render must not contain * descendant selectors');
  assert.ok(overlay.includes('.gopt-token-bar:active') && overlay.includes('.gopt-token-bar.is-syncing'));
  assert.ok(overlay.includes('html.gopt-latex-heavy .gopt-turn-manual-open'));

  const navSrc = read('src', 'content', 'strip-navigator.js');
  const colSrc = read('src', 'content', 'collapse-manager.js');
  const mainSrc = read('src', 'content', 'main.js');
  assert.ok(navSrc.includes('cachedTextLeft') && navSrc.includes('textLeftDirty') && navSrc.includes('fromScroll'));
  assert.ok(colSrc.includes('r.bottom <= 0 || r.top >= vh') && colSrc.includes('portaledBtns.has(btn)'));
  assert.ok(!mainSrc.includes('gopt-has-scroll-bottom'), 'dead gopt-has-scroll-bottom removed');
  assert.ok(mainSrc.includes('data-gopt-scrolling') && mainSrc.includes('LATEX_HEAVY_THRESHOLD = 50'));
  assert.ok(mainSrc.includes('gopt-latex-heavy') && mainSrc.includes('scrollBtnPosDirty') && mainSrc.includes('gopt-lite-latex'));
});

// ---------- Conversation Folders (LR26 Sidebar) ----------
check('selectors: LR26 conversation helpers, normalizeConvId & ligature-free extractConvTitle', () => {
  for (const key of ['sidenavHistoryContainer', 'sidenavScroller', 'notebookSection', 'chatsSection', 'sidenavConvItem', 'sidenavConvTitle']) {
    assert.ok(Array.isArray(Selectors.SEL[key]) && Selectors.SEL[key].length > 0, 'missing SEL.' + key);
  }
  assert.equal(Selectors.normalizeConvId('c_8f3a1b2c9d'), '8f3a1b2c9d');
  assert.equal(Selectors.normalizeConvId('https://gemini.google.com/u/0/app/c_8f3a1b2c9d?hl=en#sec'), '8f3a1b2c9d');
  assert.equal(Selectors.normalizeConvId('/app/abc_123-xyz'), 'abc_123-xyz');
  assert.equal(Selectors.normalizeConvId('/usage'), '');
  assert.equal(Selectors.normalizeConvId('/gems/mygem'), '');
  assert.equal(Selectors.normalizeConvId('/app'), '');
  assert.equal(Selectors.normalizeConvId(null), '');

  assert.equal(Selectors.extractConvIdFromUrl('https://gemini.google.com/app/c_abcdef1234?hl=en'), 'abcdef1234');
  assert.equal(Selectors.extractConvIdFromUrl('https://gemini.google.com/usage'), '');
  assert.equal(Selectors.extractConvIdFromUrl('https://gemini.google.com/app'), '');

  assert.equal(Selectors.extractConvIdFromItem({ getAttribute: (k) => (k === 'data-conversation-id' ? 'c_112233aa' : null) }), '112233aa');
  assert.equal(Selectors.extractConvIdFromItem({ getAttribute: () => null, querySelector: () => ({ getAttribute: (k) => (k === 'href' ? '/app/445566bb' : null) }) }), '445566bb');

  // extractConvTitle must preserve root row text even with role="button" while skipping mat-icon / nested [role="button"] / actions
  const txtNode = (v) => ({ nodeType: 3, nodeValue: v });
  const elemNode = (tag, attrs = {}, children = []) => ({
    nodeType: 1, tagName: tag.toUpperCase(),
    childNodes: children,
    hasAttribute: (k) => k in attrs,
    getAttribute: (k) => (k in attrs ? attrs[k] : null)
  });
  const rootRoleButtonRow = {
    getAttribute: (k) => (k === 'role' ? 'button' : null),
    querySelector: () => null,
    nodeType: 1, tagName: 'GEM-NAV-LIST-ITEM',
    childNodes: [
      elemNode('div', { class: 'conversation-title', role: 'button' }, [txtNode('Quantum '), txtNode('Mechanics')]),
      elemNode('mat-icon', { class: 'mat-icon' }, [txtNode('push_pin')]),
      elemNode('span', { 'aria-hidden': 'true' }, [txtNode('keep')]),
      elemNode('button', { 'aria-label': 'More' }, [elemNode('mat-icon', {}, [txtNode('more_vert')])]),
      elemNode('div', { role: 'button', 'aria-label': 'Pin' }, [txtNode('more_vert')]),
      elemNode('div', { 'data-gopt-owned': '' }, [txtNode('FolderBadge')])
    ]
  };
  // Even when queryFirst picks .conversation-title with role="button", title text is preserved cleanly without more_vert/push_pin!
  const withNestedTitle = Object.assign({}, rootRoleButtonRow, {
    querySelector: (s) => (s === '.conversation-title' ? rootRoleButtonRow.childNodes[0] : null)
  });
  assert.equal(Selectors.extractConvTitle(rootRoleButtonRow), 'Quantum Mechanics');
  assert.equal(Selectors.extractConvTitle(withNestedTitle), 'Quantum Mechanics');

  const selSrc = read('src', 'shared', 'selectors.js');
  const folderSrc = read('src', 'content', 'folder-manager.js');
  assert.ok(!/\.innerText\b/.test(selSrc) && !/\.innerText\b/.test(folderSrc), 'no layout-forcing .innerText');
});

check('folder-manager: pure reducers, 1-convo-1-folder Move semantics & orphan cleanup', () => {
  assert.equal(Folders.STORAGE_KEY, 'goptFolders');
  assert.deepEqual(Folders.FOLDER_COLORS, ['slate', 'blue', 'teal', 'amber', 'rose', 'violet']);
  assert.equal(Folders.MAX_NAME_LEN, 48);
  assert.equal(Folders.DELETE_CONFIRM_MS, 4000);

  // Corrupted input resilience & invariant enforcement (dedup convIds across folders + prune orphan convs)
  const messy = Folders.normalizeFolderStore({
    sectionCollapsed: 'yes',
    folders: [
      { id: 'f1', name: '  Work   Projects  ', color: 'blue', collapsed: false, convIds: ['c_aaa111', '/app/bbb222', 'aaa111'] },
      { id: 'f1', name: 'DupId', color: 'rose', convIds: ['ccc333'] },
      { id: 'f2', name: 'X'.repeat(80), color: 'neon', convIds: ['aaa111', 'ccc333', '/usage'] }
    ],
    convs: {
      aaa111: { title: 'My Work Chat' },
      bbb222: { title: '' },
      orphan99: { title: 'Should be pruned' }
    }
  });
  assert.equal(messy.folders.length, 2);
  assert.equal(messy.folders[0].name, 'Work Projects');
  assert.equal(messy.folders[1].name.length, 48);
  assert.equal(messy.folders[1].color, 'slate');
  assert.deepEqual(messy.folders[0].convIds, ['aaa111', 'bbb222']);
  assert.deepEqual(messy.folders[1].convIds, ['ccc333'], 'strict 1 convo = 1 folder across normalization');
  assert.equal(messy.convs.orphan99, undefined, 'unreferenced convs pruned');
  assert.equal(messy.convs.bbb222.title, 'Untitled chat');

  // Create, rename, color, toggle, Move semantics & delete cleanup
  let st = Folders.createFolder(null, { id: 'f_work', name: 'Work', color: 'teal', now: 1000 });
  st = Folders.createFolder(st, { id: 'f_study', name: 'Study', color: 'violet', now: 1001 });
  st = Folders.createFolder(st, { name: '   ' });
  assert.equal(st.folders.length, 2);

  st = Folders.assignConvToFolder(st, { folderId: 'f_work', convId: 'c_chat001', title: 'Linear Algebra', now: 2000 });
  assert.equal(Folders.findFolderForConv(st, 'chat001').id, 'f_work');
  assert.ok(Folders.getAssignedConvSet(st).has('chat001'));

  // Move to Study -> removed from Work, present only in Study
  st = Folders.assignConvToFolder(st, { folderId: 'f_study', convId: '/app/chat001', now: 2100 });
  assert.deepEqual(st.folders[0].convIds, []);
  assert.deepEqual(st.folders[1].convIds, ['chat001']);
  assert.equal(st.convs.chat001.title, 'Linear Algebra', 'preserves existing title when move omits title');

  // syncConvTitles updates live sidebar titles and ignores Untitled chat
  const synced = Folders.syncConvTitles(st, {
    chat001: { title: 'Linear Algebra II', url: 'https://gemini.google.com/app/chat001' }
  });
  assert.equal(synced.changed, true);
  assert.equal(synced.store.convs.chat001.title, 'Linear Algebra II');
  assert.equal(Folders.syncConvTitles(synced.store, { chat001: { title: 'Untitled chat' } }).changed, false);

  st = Folders.renameFolder(synced.store, 'f_study', 'Math Research');
  assert.equal(st.folders[1].name, 'Math Research');
  st = Folders.setFolderColor(st, 'f_study', 'amber');
  assert.equal(st.folders[1].color, 'amber');
  assert.equal(Folders.isCustomColor('#FF33AA'), true);
  assert.equal(Folders.isCustomColor('amber'), false);
  assert.equal(Folders.isCustomColor('#123'), false);
  st = Folders.setFolderColor(st, 'f_study', '#FF33AA');
  assert.equal(st.folders[1].color, '#ff33aa', 'normalizes valid 6-digit custom hex color');
  st = Folders.setFolderColor(st, 'f_study', 'not-a-color');
  assert.equal(st.folders[1].color, '#ff33aa', 'ignores invalid color string');
  st = Folders.toggleFolderCollapsed(st, 'f_study');
  assert.equal(st.folders[1].collapsed, true);
  st = Folders.toggleSectionCollapsed(st);
  assert.equal(st.sectionCollapsed, true);

  st = Folders.deleteFolder(st, 'f_study');
  assert.equal(st.folders.length, 1);
  assert.equal(st.convs.chat001, undefined, 'deleting folder prunes unreferenced conv metadata');

  st = Folders.assignConvToFolder(st, { folderId: 'f_work', convId: 'chat002', title: 'Doc Q&A', now: 3000 });
  st = Folders.removeConvFromFolders(st, 'c_chat002');
  assert.equal(st.folders[0].convIds.length, 0);
  assert.equal(st.convs.chat002, undefined);
});

check('folder-manager: LR26 DOM injection (Notebook vs chatsSection fallback), 1/2-click delete, SPA nav & destroy', () => {
  const prevSel = globalThis.GeminiOptSelectors;
  const prevChrome = globalThis.chrome;
  const prevLoc = globalThis.location;
  const prevSetTo = globalThis.setTimeout;
  const prevClrTo = globalThis.clearTimeout;
  const prevW = globalThis.innerWidth;
  const prevH = globalThis.innerHeight;

  function makeDomNode(tag, attrs = {}) {
    const classSet = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
    const attrMap = { ...attrs };
    const listeners = {};
    let ownText = '';
    const el = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      childNodes: [],
      children: [],
      parentNode: null,
      parentElement: null,
      style: {},
      get textContent() {
        if (el.childNodes.length === 0) return ownText;
        return el.childNodes.map((c) => (c.nodeType === 3 ? (c.nodeValue || '') : (c.textContent || ''))).join('');
      },
      set textContent(v) {
        ownText = String(v === undefined || v === null ? '' : v);
        while (el.childNodes.length) el.removeChild(el.childNodes[0]);
      },
      value: '',
      hidden: false,
      inert: false,
      get className() { return Array.from(classSet).join(' '); },
      set className(v) { classSet.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classSet.add(c)); },
      classList: {
        add: (...c) => c.forEach((x) => classSet.add(x)),
        remove: (...c) => c.forEach((x) => classSet.delete(x)),
        contains: (c) => classSet.has(c),
        toggle: (c, on) => { const n = on === undefined ? !classSet.has(c) : !!on; if (n) classSet.add(c); else classSet.delete(c); return n; }
      },
      hasAttribute: (k) => (k === 'class' ? classSet.size > 0 : k in attrMap),
      getAttribute: (k) => (k === 'class' ? Array.from(classSet).join(' ') : (k in attrMap ? attrMap[k] : null)),
      setAttribute: (k, v) => { attrMap[k] = String(v); if (k === 'class') el.className = v; },
      removeAttribute: (k) => { delete attrMap[k]; },
      appendChild(c) {
        if (c.parentNode) c.remove();
        c.parentNode = el; c.parentElement = el;
        el.childNodes.push(c); el.children.push(c);
        return c;
      },
      insertBefore(c, ref) {
        if (c.parentNode) c.remove();
        c.parentNode = el; c.parentElement = el;
        const idx = ref ? el.childNodes.indexOf(ref) : -1;
        if (idx >= 0) { el.childNodes.splice(idx, 0, c); el.children.splice(idx, 0, c); }
        else { el.childNodes.push(c); el.children.push(c); }
        return c;
      },
      removeChild(c) {
        const i = el.childNodes.indexOf(c);
        if (i >= 0) { el.childNodes.splice(i, 1); el.children.splice(i, 1); }
        c.parentNode = null; c.parentElement = null;
        return c;
      },
      remove() { if (el.parentNode) el.parentNode.removeChild(el); },
      get firstChild() { return el.childNodes[0] || null; },
      get nextSibling() {
        if (!el.parentNode) return null;
        const i = el.parentNode.childNodes.indexOf(el);
        return i >= 0 ? (el.parentNode.childNodes[i + 1] || null) : null;
      },
      get isConnected() {
        let cur = el;
        while (cur) { if (cur === docRoot) return true; cur = cur.parentNode; }
        return false;
      },
      matches(sel) {
        return sel.split(',').some((part) => {
          const p = part.trim();
          if (p.includes('.gopt-conv-folder-btn')) return classSet.has('gopt-conv-folder-btn');
          if (p.includes('.gopt-folder-picker')) return classSet.has('gopt-folder-picker');
          if (p.includes('.gopt-folder-menu')) return classSet.has('gopt-folder-menu');
          if (p.includes('[data-gopt-owned]')) return 'data-gopt-owned' in attrMap;
          if (p.includes('gem-nav-list-item') && el.tagName === 'GEM-NAV-LIST-ITEM' && attrMap['data-test-id'] === 'conversation') return true;
          if (p === 'expandable-section') return el.tagName === 'EXPANDABLE-SECTION';
          return false;
        });
      },
      closest(sel) {
        let cur = el;
        while (cur) { if (cur.matches && cur.matches(sel)) return cur; cur = cur.parentNode; }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walkTree = (n) => {
          for (const ch of n.childNodes) {
            if (ch.nodeType !== 1) continue;
            if (sel === 'gem-nav-list-item[data-test-id="conversation"]' && ch.tagName === 'GEM-NAV-LIST-ITEM' && ch.getAttribute('data-test-id') === 'conversation') out.push(ch);
            else if (sel === 'expandable-section' && ch.tagName === 'EXPANDABLE-SECTION') out.push(ch);
            else if (sel.includes('.gopt-') && ch.classList.contains(sel.slice(1))) out.push(ch);
            walkTree(ch);
          }
        };
        walkTree(el);
        return out;
      },
      querySelector(sel) {
        if (sel.includes('a[href*="/app/"]')) {
          const walkA = (n) => {
            for (const ch of n.childNodes) {
              if (ch.nodeType === 1 && ch.tagName === 'A') return ch;
              if (ch.nodeType === 1) { const r = walkA(ch); if (r) return r; }
            }
            return null;
          };
          const a = walkA(el);
          if (a) return a;
        }
        if (sel.includes('side-navigation-content expandable-section')) return hasNotebook ? notebookSec : null;
        if (sel.includes('chats-expandable-section')) return chatsSec;
        if (sel.includes('infinite-scroller')) return scroller;
        if (sel.includes('side-navigation-v2') || sel.includes('bard-sidenav')) return sidenav;
        if (sel.includes('user-query')) return null;
        if (sel.includes('.conversation-title')) return el.childNodes.find((c) => c.classList && c.classList.contains('conversation-title')) || null;
        return null;
      },
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter((f) => f !== fn); },
      _emit(ev, payload = {}) { for (const fn of (listeners[ev] || []).slice()) fn({ target: el, preventDefault() {}, stopPropagation() {}, ...payload }); },
      getBoundingClientRect: () => ({ left: 12, top: 220, right: 260, bottom: 256, width: 248, height: 36 }),
      _attrs: attrMap,
      _listeners: listeners
    };
    return el;
  }

  const docRoot = makeDomNode('html');
  const body = makeDomNode('body');
  docRoot.appendChild(body);
  const sidenav = makeDomNode('side-navigation-v2');
  const scroller = makeDomNode('infinite-scroller');
  const navList = makeDomNode('mat-nav-list');
  const notebookSec = makeDomNode('expandable-section', { 'data-test-id': 'notebook-section' });
  const chatsSec = makeDomNode('expandable-section', { 'data-test-id': 'chats-expandable-section' });
  let hasNotebook = true;

  let spaClicked = 0;
  const item1 = makeDomNode('gem-nav-list-item', { 'data-test-id': 'conversation', 'data-conversation-id': 'c_conv001' });
  const link1 = makeDomNode('a', { href: '/app/conv001' });
  link1.click = () => { spaClicked++; };
  const title1 = makeDomNode('div', { class: 'conversation-title' });
  title1.textContent = 'Folder Test Chat';
  link1.appendChild(title1);
  item1.appendChild(link1);
  chatsSec.appendChild(item1);

  scroller.appendChild(navList);
  scroller.appendChild(notebookSec);
  scroller.appendChild(chatsSec);
  sidenav.appendChild(scroller);
  body.appendChild(sidenav);

  const mockDoc = {
    documentElement: docRoot,
    body,
    title: 'Gemini',
    createElement: (tag) => makeDomNode(tag),
    querySelector: (s) => scroller.querySelector(s) || sidenav.querySelector(s),
    querySelectorAll: (s) => sidenav.querySelectorAll(s),
    addEventListener: (ev, fn) => docRoot.addEventListener(ev, fn),
    removeEventListener: (ev, fn) => docRoot.removeEventListener(ev, fn)
  };

  const memLocal = {};
  let storageChangedCb = null;
  const fakeTimers = new Map();
  let tid = 1;
  const assignedUrls = [];

  try {
    globalThis.GeminiOptSelectors = Selectors;
    globalThis.location = { href: 'https://gemini.google.com/app/conv001', assign: (u) => assignedUrls.push(u) };
    globalThis.setTimeout = (fn, ms) => { const id = tid++; fakeTimers.set(id, { fn, ms }); return id; };
    globalThis.clearTimeout = (id) => { fakeTimers.delete(id); };
    globalThis.innerWidth = 1280;
    globalThis.innerHeight = 800;
    globalThis.chrome = {
      runtime: { lastError: null },
      storage: {
        local: {
          get: (k, cb) => cb({ [k]: memLocal[k] }),
          set: (o, cb) => { Object.assign(memLocal, o); if (cb) cb(); }
        },
        onChanged: {
          addListener: (fn) => { storageChangedCb = fn; },
          removeListener: () => { storageChangedCb = null; }
        }
      }
    };

    Folders.setEnabled(true);
    Folders.mount(mockDoc);

    // Mounted right before Notebook section with divider!
    const secIdx = scroller.childNodes.findIndex((n) => n.classList.contains('gopt-folders-section'));
    const divIdx = scroller.childNodes.findIndex((n) => n.classList.contains('gopt-folders-divider'));
    const nbIdx = scroller.childNodes.indexOf(notebookSec);
    assert.ok(secIdx >= 0 && divIdx === secIdx + 1 && nbIdx === divIdx + 1, 'injected section + divider directly before Notebook');

    // Create empty folder via composer Enter & delete in 1 click; create non-empty folder & verify 2-click delete
    const secEl = scroller.childNodes[secIdx];
    const addBtn = secEl.querySelectorAll('.gopt-folder-add-btn')[0];
    addBtn._emit('click');
    const compInput = secEl.querySelectorAll('.gopt-folder-input')[0];
    compInput.value = 'TempEmpty';
    compInput._emit('keydown', { key: 'Enter' });
    for (const [, t] of fakeTimers) t.fn();
    fakeTimers.clear();
    assert.equal(memLocal[Folders.STORAGE_KEY].folders.length, 1);

    // 1-click immediate delete when folder is empty; also verify zero count badges, menu order (Rename -> Delete -> Colors) & custom swatch last
    assert.equal(secEl.querySelectorAll('.gopt-folders-count').length, 0, 'no folder count badge in header');
    assert.equal(secEl.querySelectorAll('.gopt-folder-badge').length, 0, 'no convo count badge on folder row');
    const compSwatches = secEl.querySelectorAll('.gopt-color-dots')[0];
    assert.equal(compSwatches.childNodes.length, Folders.COMPOSER_COLORS.length + 1, 'reduced composer swatches (3 presets + custom)');
    assert.ok(compSwatches.childNodes[compSwatches.childNodes.length - 1].classList.contains('gopt-color-custom'), 'custom color is last choice in composer');

    const menuBtn1 = secEl.querySelectorAll('.gopt-folder-menu-btn')[0];
    menuBtn1._emit('click');
    const menuEl = body.childNodes.find((n) => n.classList.contains('gopt-folder-menu'));
    assert.equal(menuEl.childNodes.length, 3, 'menu has Rename, Delete, Colors');
    assert.equal(menuEl.childNodes[0].textContent, 'Rename', '1st menu item is Rename');
    assert.equal(menuEl.childNodes[1].textContent, 'Delete', '2nd menu item is Delete');
    assert.ok(menuEl.childNodes[2].classList.contains('gopt-menu-colors'), '3rd menu item is Color picker');
    const menuColors = menuEl.childNodes[2];
    assert.equal(menuColors.childNodes.length, Folders.FOLDER_COLORS.length + 1, '3-dot menu keeps all 6 presets + custom');
    const customSwatch = menuColors.childNodes[menuColors.childNodes.length - 1];
    assert.ok(customSwatch.classList.contains('gopt-color-custom'), 'custom color is last choice in 3-dot menu');
    const customInput = customSwatch.querySelectorAll('.gopt-color-native')[0];
    customInput.value = '#12AB89';
    customInput._emit('input');
    assert.equal(secEl.querySelectorAll('.gopt-folder-dot')[0].style.backgroundColor, '#12ab89', 'live custom hex applied to folder dot');
    assert.equal(customSwatch.getAttribute('data-active'), '1');

    const delBtn1 = menuEl.childNodes.find((n) => n.classList && n.classList.contains('is-danger'));
    delBtn1._emit('click');
    for (const [, t] of fakeTimers) t.fn();
    fakeTimers.clear();
    assert.equal(memLocal[Folders.STORAGE_KEY].folders.length, 0, '1-click deletes empty folder immediately');

    // Hover portal assigns conv001 -> stamps data-gopt-in-folder="1"
    addBtn._emit('click');
    compInput.value = 'WorkFolder';
    compInput._emit('keydown', { key: 'Enter' });
    sidenav._listeners.pointerover[0]({ target: title1 });
    const hoverBtn = body.childNodes.find((n) => n.classList.contains('gopt-conv-folder-btn'));
    assert.equal(hoverBtn.hidden, false);
    assert.equal(hoverBtn.style.left, '196px');
    hoverBtn._emit('click');
    const pickerEl = body.childNodes.find((n) => n.classList.contains('gopt-folder-picker'));
    const pickItem = pickerEl.querySelectorAll('.gopt-picker-item')[0];
    pickItem._emit('click');
    for (const [, t] of fakeTimers) t.fn();
    fakeTimers.clear();
    assert.equal(item1.getAttribute('data-gopt-in-folder'), '1', 'stamps data-gopt-in-folder="1" on sidebar item');

    // SPA click navigates via native sidebar item click when mounted; falls back to URL when absent
    const chatLink = secEl.querySelectorAll('.gopt-folder-chat-link')[0];
    chatLink._emit('click');
    assert.equal(spaClicked, 1, 'triggers native sidebar click for SPA transition');
    item1.remove();
    chatLink._emit('click');
    assert.equal(assignedUrls[0], 'https://gemini.google.com/app/conv001', 'falls back to URL when item absent');
    chatsSec.appendChild(item1);

    // 2-click delete confirmation for non-empty folder (4000ms reset)
    const menuBtn2 = secEl.querySelectorAll('.gopt-folder-menu-btn')[0];
    menuBtn2._emit('click');
    let delBtn2 = menuEl.childNodes.find((n) => n.classList && n.classList.contains('is-danger'));
    delBtn2._emit('click');
    delBtn2 = menuEl.childNodes.find((n) => n.classList && n.classList.contains('is-danger'));
    assert.equal(delBtn2.textContent, 'Click again to confirm');
    // Simulate 4000ms timer expiry resets confirmation
    const confirmTimer = Array.from(fakeTimers.entries()).find(([, v]) => v.ms === 4000);
    assert.ok(confirmTimer, 'schedules 4000ms confirm timeout');
    fakeTimers.delete(confirmTimer[0]);
    confirmTimer[1].fn();
    delBtn2 = menuEl.childNodes.find((n) => n.classList && n.classList.contains('is-danger'));
    assert.equal(delBtn2.textContent, 'Delete', '4000ms timer resets confirmation text');

    // Now perform real 2-click delete
    delBtn2._emit('click');
    delBtn2 = menuEl.childNodes.find((n) => n.classList && n.classList.contains('is-danger'));
    delBtn2._emit('click');
    for (const [, t] of fakeTimers) t.fn();
    fakeTimers.clear();
    assert.equal(memLocal[Folders.STORAGE_KEY].folders.length, 0);
    assert.equal(item1.getAttribute('data-gopt-in-folder'), null, 'deleting folder clears data-gopt-in-folder');

    // Fallback before chats-expandable-section when Notebook absent + chrome.storage.onChanged cross-tab sync + destroy()
    hasNotebook = false;
    notebookSec.remove();
    storageChangedCb({
      [Folders.STORAGE_KEY]: {
        newValue: {
          version: 1, sectionCollapsed: false,
          folders: [{ id: 'f_sync', name: 'Synced', color: 'blue', collapsed: false, convIds: ['conv001'] }],
          convs: { conv001: { id: 'conv001', title: 'Synced Chat', url: 'https://gemini.google.com/app/conv001', updatedAt: 1 } }
        }
      }
    }, 'local');
    const secIdx2 = scroller.childNodes.findIndex((n) => n.classList.contains('gopt-folders-section'));
    const chatsIdx = scroller.childNodes.indexOf(chatsSec);
    assert.ok(secIdx2 >= 0 && chatsIdx === secIdx2 + 2, 'falls back directly before chats-expandable-section');
    assert.equal(item1.getAttribute('data-gopt-in-folder'), '1');

    // Regression: self-echo & external storage.onChanged while inline Rename / picker "+ New folder" is active must NOT clobber input
    for (const [, t] of fakeTimers) t.fn();
    fakeTimers.clear();
    const syncMenuBtn = secEl.querySelectorAll('.gopt-folder-menu-btn')[0];
    syncMenuBtn._emit('click');
    const renMenuBtn = menuEl.childNodes.find((n) => n.textContent === 'Rename');
    renMenuBtn._emit('click');
    const renInput = secEl.querySelectorAll('.gopt-folder-rename-input')[0];
    assert.ok(renInput, 'inline rename input mounted');
    renInput.value = 'DraftRename';

    const assignCurBtn = secEl.querySelectorAll('.gopt-assign-current-btn')[0];
    assignCurBtn._emit('click');
    const pickerNewBtn = pickerEl.querySelectorAll('.gopt-picker-new-btn')[0];
    pickerNewBtn._emit('click');
    const pickerInput = pickerEl.querySelectorAll('.gopt-folder-input')[0];
    assert.ok(pickerInput, 'picker new-folder input mounted');
    pickerInput.value = 'DraftNewPicker';

    // Fire true self-echo storage event -> exact input nodes & draft values survive
    const selfEchoPayload = {
      version: 1, sectionCollapsed: false,
      folders: [{ id: 'f_sync', name: 'Synced', color: 'blue', collapsed: false, convIds: ['conv001'] }],
      convs: { conv001: { id: 'conv001', title: 'Folder Test Chat', url: 'https://gemini.google.com/app/conv001', updatedAt: 1 } }
    };
    storageChangedCb({ [Folders.STORAGE_KEY]: { newValue: selfEchoPayload } }, 'local');
    assert.ok(secEl.querySelectorAll('.gopt-folder-rename-input')[0] === renInput, 'self-echo keeps exact rename input node');
    assert.equal(renInput.value, 'DraftRename');
    assert.ok(pickerEl.querySelectorAll('.gopt-folder-input')[0] === pickerInput, 'self-echo keeps exact picker input node');
    assert.equal(pickerInput.value, 'DraftNewPicker');

    // Fire external storage update while inline edits are active -> inputs survive AND Escape restores rendered external update
    const item2 = makeDomNode('gem-nav-list-item', { 'data-test-id': 'conversation', 'data-conversation-id': 'c_conv002' });
    const link2 = makeDomNode('a', { href: '/app/conv002' });
    const title2 = makeDomNode('div', { class: 'conversation-title' });
    title2.textContent = 'External Chat';
    link2.appendChild(title2);
    item2.appendChild(link2);
    chatsSec.appendChild(item2);

    storageChangedCb({
      [Folders.STORAGE_KEY]: {
        newValue: {
          version: 1, sectionCollapsed: false,
          folders: [{ id: 'f_ext', name: 'FromOtherTab', color: 'teal', collapsed: false, convIds: ['conv002'] }],
          convs: { conv002: { id: 'conv002', title: 'External Chat', url: 'https://gemini.google.com/app/conv002', updatedAt: 2 } }
        }
      }
    }, 'local');
    assert.ok(secEl.querySelectorAll('.gopt-folder-rename-input')[0] === renInput, 'external sync skips rebuilding active rename input');
    assert.equal(renInput.value, 'DraftRename');
    assert.ok(pickerEl.querySelectorAll('.gopt-folder-input')[0] === pickerInput, 'external sync skips wiping active picker input');
    assert.equal(pickerInput.value, 'DraftNewPicker');
    assert.equal(item2.getAttribute('data-gopt-in-folder'), '1', 'syncConvStamps still stamps new external assignments');
    assert.equal(item1.getAttribute('data-gopt-in-folder'), null);

    // Committing/canceling inline rename renders the external folder list cleanly
    renInput._emit('keydown', { key: 'Escape' });
    assert.equal(secEl.querySelectorAll('.gopt-folder-name')[0].textContent, 'FromOtherTab');

    // Async loadStore race: dirtyStore === true prevents stale storage.get from overwriting local unsaved edits
    Folders.destroy();
    let deferredGetCb = null;
    globalThis.chrome.storage.local.get = (_k, cb) => { deferredGetCb = cb; };
    hasNotebook = true;
    scroller.insertBefore(notebookSec, chatsSec);
    Folders.setEnabled(true);
    Folders.mount(mockDoc);
    const secAfter = scroller.querySelectorAll('.gopt-folders-section')[0];
    secAfter.querySelectorAll('.gopt-folder-add-btn')[0]._emit('click');
    const compAfter = scroller.querySelectorAll('.gopt-folder-input')[0];
    compAfter.value = 'LocalUnsaved';
    compAfter._emit('keydown', { key: 'Enter' });
    deferredGetCb({ [Folders.STORAGE_KEY]: { version: 1, folders: [], convs: {} } });
    assert.equal(scroller.querySelectorAll('.gopt-folder-name')[0].textContent, 'LocalUnsaved', 'loadStore ignores stale result when dirtyStore is true');

    Folders.destroy();
    assert.equal(item1.getAttribute('data-gopt-in-folder'), null, 'destroy clears stamped attributes');
    assert.equal(item2.getAttribute('data-gopt-in-folder'), null, 'destroy clears stamped attributes on item2');
    assert.equal(scroller.childNodes.some((n) => n.classList.contains('gopt-folders-section')), false, 'destroy removes section');
    assert.equal(body.childNodes.some((n) => n.classList.contains('gopt-conv-folder-btn')), false, 'destroy removes portals');
  } finally {
    globalThis.GeminiOptSelectors = prevSel;
    globalThis.chrome = prevChrome;
    if (prevLoc !== undefined) globalThis.location = prevLoc;
    else delete globalThis.location;
    globalThis.setTimeout = prevSetTo;
    globalThis.clearTimeout = prevClrTo;
    globalThis.innerWidth = prevW;
    globalThis.innerHeight = prevH;
  }

  // Contract checks across manifest, folder-manager, main.js & ui-overlay.css
  const endJs = manifest.content_scripts.find((c) => c.run_at === 'document_end').js;
  assert.ok(endJs.indexOf('src/content/folder-manager.js') >= 0 && endJs.indexOf('src/content/folder-manager.js') < endJs.indexOf('src/content/token-tracker.js'));
  const folderSrc = read('src', 'content', 'folder-manager.js');
  assert.ok(!/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|style\.setProperty|\.innerText\b|window\.(?:prompt|confirm|alert)\b/.test(folderSrc), 'CSP/DOM safety');
  const mainSrc = read('src', 'content', 'main.js');
  assert.ok(mainSrc.includes('gopt-folders-active') && mainSrc.includes('Folders.mount(document)') && mainSrc.includes('Folders.updateRoute(') && mainSrc.includes('Folders.destroy()'));
  assert.ok(overlay.includes('.sidenav-with-history-container:not(.expanded) .gopt-folders-section'));
  assert.ok(overlay.includes('html.gopt-folders-active :is(gem-nav-list-item, [data-test-id="conversation"])[data-gopt-in-folder="1"]'));
  assert.ok(!overlay.includes('.gopt-folders-count') && !overlay.includes('.gopt-folder-badge'), 'count badge CSS removed');
  assert.ok(overlay.includes('.gopt-color-custom') && overlay.includes('.gopt-folder-card.is-expanded') && overlay.includes('.gopt-menu-item.is-danger:hover'));
});

// ---------- syntax ----------
check('syntax: node --check on every src/**/*.js', () => {
  const files = walk(p('src'), '.js');
  assert.ok(files.length >= 9, 'expected >= 9 js files, got ' + files.length);
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
