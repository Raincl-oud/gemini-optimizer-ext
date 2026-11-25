/* Gemini Web Optimizer - LR26 sidebar Conversation Folders (pure state core + DOM adapter). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GeminiOptFolders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'goptFolders';
  const STORE_VERSION = 1;
  const FOLDER_COLORS = Object.freeze(['slate', 'blue', 'teal', 'amber', 'rose', 'violet']);
  const MAX_NAME_LEN = 48;
  const MAX_FOLDERS = 60;
  const MAX_CONVS = 600;
  const DELETE_CONFIRM_MS = 4000;
  const HOVER_HIDE_GRACE_MS = 120;
  const OBSERVER_DEBOUNCE_MS = 120;
  const SAVE_DEBOUNCE_MS = 200;

  const RESERVED_IDS = new Set(['app', 'usage', 'gems', 'settings', 'saved-info', 'extensions', 'updates', 'u']);
  const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let idSeq = 0;

  function Sel() { return root.GeminiOptSelectors; }

  function isCustomColor(c) {
    return typeof c === 'string' && HEX_COLOR_RE.test(c.trim());
  }

  function normConvId(raw) {
    const Svc = Sel();
    if (Svc && typeof Svc.normalizeConvId === 'function') return Svc.normalizeConvId(raw);
    if (!raw || typeof raw !== 'string') return '';
    let s = raw.trim().split(/[?#]/)[0].replace(/\/+$/, '');
    s = s.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '').replace(/^u\/\d+\//i, '').replace(/^app\//i, '').replace(/^c_/i, '');
    if (!s || RESERVED_IDS.has(s.toLowerCase())) return '';
    return /^[a-zA-Z0-9_-]{3,128}$/.test(s) ? s : '';
  }

  function cleanStr(raw, maxLen) {
    const s = String(raw === undefined || raw === null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    return maxLen && s.length > maxLen ? s.slice(0, maxLen).trim() : s;
  }

  function nonNegNum(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function validAppUrl(cid, url) {
    const Svc = Sel();
    const u = typeof url === 'string' ? url.trim() : '';
    if (u) {
      const extracted = Svc && Svc.extractConvIdFromUrl ? Svc.extractConvIdFromUrl(u) : normConvId(u);
      if (extracted === cid) return u.startsWith('/') ? ('https://gemini.google.com' + u) : u;
    }
    return 'https://gemini.google.com/app/' + cid;
  }

  function validColor(c) {
    if (typeof c !== 'string') return 'slate';
    const t = c.trim().toLowerCase();
    if (FOLDER_COLORS.includes(t)) return t;
    if (HEX_COLOR_RE.test(t)) return t;
    return 'slate';
  }

  function nextFolderId(nowTs, existingIds) {
    const ts = nonNegNum(nowTs) || Date.now();
    let candidate = '';
    do {
      idSeq = (idSeq + 1) % 100000;
      candidate = 'f_' + ts.toString(36) + '_' + idSeq.toString(36);
    } while (existingIds && existingIds.has(candidate));
    return candidate;
  }

  // ---------- pure store reducers ----------
  function normalizeFolderStore(raw) {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const sectionCollapsed = !!r.sectionCollapsed;
    const rawFolders = Array.isArray(r.folders) ? r.folders : [];
    const rawConvs = r.convs && typeof r.convs === 'object' && !Array.isArray(r.convs) ? r.convs : {};

    const seenFolderIds = new Set();
    const seenConvIds = new Set();
    const folders = [];

    for (let i = 0; i < rawFolders.length && folders.length < MAX_FOLDERS; i++) {
      const f = rawFolders[i];
      if (!f || typeof f !== 'object') continue;
      const fid = cleanStr(f.id, 64);
      if (!fid || seenFolderIds.has(fid)) continue;
      seenFolderIds.add(fid);

      const convIds = [];
      const srcConvIds = Array.isArray(f.convIds) ? f.convIds : [];
      for (let j = 0; j < srcConvIds.length && seenConvIds.size < MAX_CONVS; j++) {
        const cid = normConvId(srcConvIds[j]);
        if (!cid || seenConvIds.has(cid)) continue;
        seenConvIds.add(cid);
        convIds.push(cid);
      }

      folders.push({
        id: fid,
        name: cleanStr(f.name, MAX_NAME_LEN) || 'Folder',
        color: validColor(f.color),
        collapsed: !!f.collapsed,
        convIds: convIds
      });
    }

    const convs = {};
    for (const cid of seenConvIds) {
      const meta = rawConvs[cid] && typeof rawConvs[cid] === 'object' ? rawConvs[cid] : {};
      convs[cid] = {
        id: cid,
        title: cleanStr(meta.title, 140) || 'Untitled chat',
        url: validAppUrl(cid, meta.url),
        updatedAt: nonNegNum(meta.updatedAt)
      };
    }

    return {
      version: STORE_VERSION,
      sectionCollapsed: sectionCollapsed,
      folders: folders,
      convs: convs
    };
  }

  function createFolder(store, opts) {
    const norm = normalizeFolderStore(store);
    const o = typeof opts === 'string' ? { name: opts } : (opts || {});
    const name = cleanStr(o.name, MAX_NAME_LEN);
    if (!name || norm.folders.length >= MAX_FOLDERS) return norm;
    const ids = new Set(norm.folders.map(function (f) { return f.id; }));
    const customId = cleanStr(o.id, 64);
    const id = customId && !ids.has(customId) ? customId : nextFolderId(o.now, ids);
    norm.folders.push({
      id: id,
      name: name,
      color: validColor(o.color),
      collapsed: false,
      convIds: []
    });
    return normalizeFolderStore(norm);
  }

  function renameFolder(store, folderId, newName) {
    const norm = normalizeFolderStore(store);
    const name = cleanStr(newName, MAX_NAME_LEN);
    if (!name) return norm;
    for (let i = 0; i < norm.folders.length; i++) {
      if (norm.folders[i].id === folderId) {
        norm.folders[i].name = name;
        break;
      }
    }
    return norm;
  }

  function setFolderColor(store, folderId, color) {
    const norm = normalizeFolderStore(store);
    if (typeof color !== 'string') return norm;
    const nextColor = color.trim().toLowerCase();
    if (!FOLDER_COLORS.includes(nextColor) && !HEX_COLOR_RE.test(nextColor)) return norm;
    for (let i = 0; i < norm.folders.length; i++) {
      if (norm.folders[i].id === folderId) {
        norm.folders[i].color = nextColor;
        break;
      }
    }
    return norm;
  }

  function toggleFolderCollapsed(store, folderId) {
    const norm = normalizeFolderStore(store);
    for (let i = 0; i < norm.folders.length; i++) {
      if (norm.folders[i].id === folderId) {
        norm.folders[i].collapsed = !norm.folders[i].collapsed;
        break;
      }
    }
    return norm;
  }

  function toggleSectionCollapsed(store) {
    const norm = normalizeFolderStore(store);
    norm.sectionCollapsed = !norm.sectionCollapsed;
    return norm;
  }

  function deleteFolder(store, folderId) {
    const norm = normalizeFolderStore(store);
    norm.folders = norm.folders.filter(function (f) { return f.id !== folderId; });
    return normalizeFolderStore(norm);
  }

  function assignConvToFolder(store, opts) {
    const norm = normalizeFolderStore(store);
    const o = opts || {};
    const cid = normConvId(o.convId);
    if (!cid || !o.folderId) return norm;
    const target = norm.folders.find(function (f) { return f.id === o.folderId; });
    if (!target) return norm;

    const alreadyInTarget = target.convIds.includes(cid);
    if (!alreadyInTarget && Object.keys(norm.convs).length >= MAX_CONVS) {
      return norm;
    }

    for (let i = 0; i < norm.folders.length; i++) {
      const f = norm.folders[i];
      if (f === target && alreadyInTarget) continue;
      f.convIds = f.convIds.filter(function (id) { return id !== cid; });
    }
    if (!alreadyInTarget) target.convIds.unshift(cid);

    const prev = norm.convs[cid] || {};
    const nextTitle = cleanStr(o.title, 140);
    const resolvedTitle = (nextTitle && nextTitle !== 'Untitled chat')
      ? nextTitle
      : (prev.title && prev.title !== 'Untitled chat' ? prev.title : (nextTitle || 'Untitled chat'));
    norm.convs[cid] = {
      id: cid,
      title: resolvedTitle,
      url: validAppUrl(cid, o.url || prev.url),
      updatedAt: nonNegNum(o.now) || Date.now()
    };
    return normalizeFolderStore(norm);
  }

  function removeConvFromFolders(store, convId) {
    const norm = normalizeFolderStore(store);
    const cid = normConvId(convId);
    if (!cid) return norm;
    for (let i = 0; i < norm.folders.length; i++) {
      norm.folders[i].convIds = norm.folders[i].convIds.filter(function (id) { return id !== cid; });
    }
    delete norm.convs[cid];
    return normalizeFolderStore(norm);
  }

  function syncConvTitles(store, itemsMap) {
    const norm = normalizeFolderStore(store);
    if (!itemsMap) return { store: norm, changed: false };
    let changed = false;
    const readEntry = function (cid) {
      if (typeof itemsMap.get === 'function') return itemsMap.get(cid);
      return itemsMap[cid];
    };
    for (const cid of Object.keys(norm.convs)) {
      const entry = readEntry(cid);
      if (!entry || typeof entry !== 'object') continue;
      const incomingTitle = cleanStr(entry.title, 140);
      const cur = norm.convs[cid];
      if (incomingTitle && incomingTitle !== 'Untitled chat' && incomingTitle !== cur.title) {
        cur.title = incomingTitle;
        changed = true;
      }
      if (entry.url) {
        const nextUrl = validAppUrl(cid, entry.url);
        if (nextUrl !== cur.url) {
          cur.url = nextUrl;
          changed = true;
        }
      }
    }
    return { store: norm, changed: changed };
  }

  function findFolderForConv(store, convId) {
    const norm = normalizeFolderStore(store);
    const cid = normConvId(convId);
    if (!cid) return null;
    for (let i = 0; i < norm.folders.length; i++) {
      if (norm.folders[i].convIds.includes(cid)) return norm.folders[i];
    }
    return null;
  }

  function getAssignedConvSet(store) {
    const norm = normalizeFolderStore(store);
    const set = new Set();
    for (let i = 0; i < norm.folders.length; i++) {
      for (const cid of norm.folders[i].convIds) set.add(cid);
    }
    return set;
  }

  // ---------- DOM adapter ----------
  const S = {
    doc: null,
    enabled: true,
    mounted: false,
    store: normalizeFolderStore(null),
    storeLoaded: false,
    dirtyStore: false,
    saveTimer: 0,
    currentUrl: '',

    sectionEl: null,
    dividerEl: null,
    toggleBtn: null,
    assignCurBtn: null,
    addBtn: null,
    composerEl: null,
    composerInput: null,
    composerColor: 'slate',
    bodyEl: null,
    listEl: null,
    composerOpen: false,
    renamingFolderId: null,

    hoverBtn: null,
    hoverItem: null,
    hoverConvId: '',
    hoverConvTitle: '',
    hoverHideTimer: 0,

    pickerEl: null,
    pickerOpen: false,
    pickerAnchorEl: null,
    pickerConvId: '',
    pickerConvTitle: '',
    pickerConvUrl: '',
    pickerAdding: false,
    pickerNewColor: 'slate',

    menuEl: null,
    menuOpen: false,
    menuFolderId: null,
    menuAnchorEl: null,
    deleteConfirmFolderId: null,
    deleteConfirmTimer: 0,

    sidenavEl: null,
    scrollEl: null,
    mo: null,
    moTimer: 0,
    storageListener: null,
    docKeyListener: null,
    docPointerListener: null,
    stampedItems: new Set(),
    lastRenderSig: ''
  };

  function storageArea() {
    return root.chrome && root.chrome.storage ? root.chrome.storage.local : null;
  }

  function isAttached(node) {
    if (!node) return false;
    if (typeof node.isConnected === 'boolean') return node.isConnected;
    return !!node.parentNode;
  }

  function createEl(doc, tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function createSvg(doc, size, paths, circles) {
    const svg = typeof doc.createElementNS === 'function'
      ? doc.createElementNS(SVG_NS, 'svg')
      : doc.createElement('svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (paths) {
      for (const d of paths) {
        const p = typeof doc.createElementNS === 'function'
          ? doc.createElementNS(SVG_NS, 'path')
          : doc.createElement('path');
        p.setAttribute('d', d);
        svg.appendChild(p);
      }
    }
    if (circles) {
      for (const c of circles) {
        const el = typeof doc.createElementNS === 'function'
          ? doc.createElementNS(SVG_NS, 'circle')
          : doc.createElement('circle');
        el.setAttribute('cx', String(c[0]));
        el.setAttribute('cy', String(c[1]));
        el.setAttribute('r', String(c[2]));
        el.setAttribute('fill', 'currentColor');
        el.setAttribute('stroke', 'none');
        svg.appendChild(el);
      }
    }
    return svg;
  }

  function writeStoreNow() {
    S.dirtyStore = false;
    const area = storageArea();
    if (!area || typeof area.set !== 'function') return;
    try {
      const payload = {};
      payload[STORAGE_KEY] = S.store;
      area.set(payload, function () {
        void (root.chrome && root.chrome.runtime && root.chrome.runtime.lastError);
      });
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
    }, SAVE_DEBOUNCE_MS);
  }

  function flushPersist() {
    root.clearTimeout(S.saveTimer);
    S.saveTimer = 0;
    if (S.dirtyStore) writeStoreNow();
  }

  function commitStore(nextStore, immediate) {
    S.store = normalizeFolderStore(nextStore);
    S.lastRenderSig = '';
    if (immediate) {
      S.dirtyStore = true;
      flushPersist();
    } else {
      schedulePersist();
    }
    renderSection();
    syncSidebar();
    if (S.pickerOpen) renderPicker();
    if (S.menuOpen) renderMenu();
  }

  function activeConvId() {
    const Svc = Sel();
    const url = S.currentUrl || (root.location ? root.location.href : '');
    if (Svc && typeof Svc.extractConvIdFromUrl === 'function') return Svc.extractConvIdFromUrl(url);
    return normConvId(url);
  }

  function resolveCurrentConvInfo() {
    const doc = S.doc;
    const cid = activeConvId();
    if (!cid) return null;
    let title = '';
    const Svc = Sel();
    if (Svc && doc) {
      const items = Svc.findSidenavConvItems(doc);
      for (const item of items) {
        if (Svc.extractConvIdFromItem(item) === cid) {
          title = Svc.extractConvTitle(item);
          if (title) break;
        }
      }
      if (!title && S.store.convs[cid] && S.store.convs[cid].title !== 'Untitled chat') {
        title = S.store.convs[cid].title;
      }
      if (!title) {
        const firstQ = Svc.queryFirst(doc, Svc.SEL.userQuery);
        if (firstQ) title = cleanStr(firstQ.textContent, 80);
      }
    }
    if (!title && doc && typeof doc.title === 'string') {
      const dt = cleanStr(doc.title.replace(/\s*[-|]\s*Google Gemini$/i, ''), 80);
      if (dt && !/^(google\s*)?gemini$/i.test(dt)) title = dt;
    }
    return {
      convId: cid,
      title: title || 'Untitled chat',
      url: 'https://gemini.google.com/app/' + cid
    };
  }

  // ---------- sidebar anchoring & chat hiding ----------
  function clearStampedItems() {
    for (const el of Array.from(S.stampedItems)) {
      if (el && el.removeAttribute) el.removeAttribute('data-gopt-in-folder');
    }
    S.stampedItems.clear();
  }

  function applyColorAttr(el, color) {
    if (!el || !el.setAttribute) return;
    el.setAttribute('data-color', isCustomColor(color) ? 'custom' : validColor(color));
  }

  function applyDotColor(dotEl, color) {
    if (!dotEl || !dotEl.style) return;
    dotEl.style.backgroundColor = isCustomColor(color) ? color : '';
  }

  function buildColorSwatchRow(doc, cls, getCurrentColor, onPreset, onCustomInput, onCustomChange) {
    const row = createEl(doc, 'div', cls);
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Folder color');

    const presetBtns = [];
    const customLabel = createEl(doc, 'label', 'gopt-color-dot gopt-color-custom');
    customLabel.setAttribute('aria-label', 'Custom folder color');
    customLabel.title = 'Custom color';
    const customInput = createEl(doc, 'input', 'gopt-color-native');
    customInput.type = 'color';
    customInput.setAttribute('aria-label', 'Choose custom folder color');
    customLabel.appendChild(customInput);

    const syncSwatches = function (activeColor) {
      const customActive = isCustomColor(activeColor);
      for (const b of presetBtns) {
        const c = b.getAttribute('data-color');
        b.setAttribute('aria-pressed', (!customActive && c === activeColor) ? 'true' : 'false');
      }
      if (customLabel.classList) customLabel.classList.toggle('is-active', customActive);
      customLabel.setAttribute('data-active', customActive ? '1' : '0');
      customLabel.style.backgroundColor = customActive ? activeColor : '';
      customInput.value = customActive ? activeColor : '#3b82f6';
    };

    for (const c of FOLDER_COLORS) {
      const dot = createEl(doc, 'button', 'gopt-color-dot');
      dot.type = 'button';
      dot.setAttribute('data-color', c);
      dot.setAttribute('aria-label', 'Color ' + c);
      dot.addEventListener('click', function () {
        syncSwatches(c);
        onPreset(c);
      });
      presetBtns.push(dot);
      row.appendChild(dot);
    }

    customInput.addEventListener('input', function () {
      const hex = validColor(customInput.value);
      if (!isCustomColor(hex)) return;
      syncSwatches(hex);
      onCustomInput(hex);
    });
    customInput.addEventListener('change', function () {
      const hex = validColor(customInput.value);
      if (!isCustomColor(hex)) return;
      syncSwatches(hex);
      onCustomChange(hex);
    });

    row.appendChild(customLabel);
    syncSwatches(getCurrentColor());
    return { row: row, sync: syncSwatches };
  }

  function ensureSectionDom() {
    const doc = S.doc;
    if (!doc || S.sectionEl) return;

    const sec = createEl(doc, 'section', 'gopt-folders-section');
    sec.setAttribute('data-gopt-owned', '');
    sec.setAttribute('aria-label', 'Conversation folders');

    const hdr = createEl(doc, 'div', 'gopt-folders-header');
    const toggleBtn = createEl(doc, 'button', 'gopt-folders-toggle');
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.appendChild(createSvg(doc, 14, ['M6 9l6 6 6-6']));
    toggleBtn.appendChild(createEl(doc, 'span', 'gopt-folders-title', 'Folders'));
    toggleBtn.addEventListener('click', function () {
      commitStore(toggleSectionCollapsed(S.store));
    });

    const hdrActions = createEl(doc, 'div', 'gopt-folders-hdr-actions');
    const assignCurBtn = createEl(doc, 'button', 'gopt-assign-current-btn');
    assignCurBtn.type = 'button';
    assignCurBtn.hidden = true;
    assignCurBtn.setAttribute('aria-label', 'Add current chat to folder');
    assignCurBtn.title = 'Add current chat to folder';
    assignCurBtn.appendChild(createSvg(doc, 13, ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']));
    assignCurBtn.appendChild(createEl(doc, 'span', null, '+ Current'));
    assignCurBtn.addEventListener('click', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      const info = resolveCurrentConvInfo();
      if (!info) return;
      openPicker(assignCurBtn, info);
    });

    const addBtn = createEl(doc, 'button', 'gopt-folder-add-btn');
    addBtn.type = 'button';
    addBtn.setAttribute('aria-label', 'New folder');
    addBtn.title = 'New folder';
    addBtn.appendChild(createSvg(doc, 14, ['M12 5v14', 'M5 12h14']));
    addBtn.addEventListener('click', function () {
      if (S.store.sectionCollapsed) {
        S.store = toggleSectionCollapsed(S.store);
        schedulePersist();
      }
      S.composerOpen = !S.composerOpen;
      S.lastRenderSig = '';
      renderSection();
      if (S.composerOpen && S.composerInput && S.composerInput.focus) {
        S.composerInput.focus();
      }
    });

    hdrActions.appendChild(assignCurBtn);
    hdrActions.appendChild(addBtn);
    hdr.appendChild(toggleBtn);
    hdr.appendChild(hdrActions);
    sec.appendChild(hdr);

    // Inline New Folder composer
    const composer = createEl(doc, 'div', 'gopt-folder-composer');
    composer.hidden = true;
    const compInput = createEl(doc, 'input', 'gopt-folder-input');
    compInput.type = 'text';
    compInput.maxLength = MAX_NAME_LEN;
    compInput.placeholder = 'Folder name...';
    compInput.setAttribute('aria-label', 'New folder name');

    const compPalette = buildColorSwatchRow(
      doc,
      'gopt-color-dots',
      function () { return S.composerColor; },
      function (c) { S.composerColor = c; },
      function (hex) { S.composerColor = hex; },
      function (hex) { S.composerColor = hex; }
    );
    const compDots = compPalette.row;

    const submitComposer = function () {
      const name = cleanStr(compInput.value, MAX_NAME_LEN);
      if (!name) return;
      compInput.value = '';
      S.composerOpen = false;
      commitStore(createFolder(S.store, { name: name, color: S.composerColor }));
    };
    const cancelComposer = function () {
      compInput.value = '';
      S.composerOpen = false;
      S.lastRenderSig = '';
      renderSection();
    };
    compInput.addEventListener('keydown', function (ev) {
      if (!ev) return;
      if (ev.key === 'Enter') {
        if (ev.preventDefault) ev.preventDefault();
        submitComposer();
      } else if (ev.key === 'Escape') {
        if (ev.preventDefault) ev.preventDefault();
        cancelComposer();
      }
    });

    const compActions = createEl(doc, 'div', 'gopt-composer-actions');
    const compSave = createEl(doc, 'button', 'gopt-btn-primary', 'Add');
    compSave.type = 'button';
    compSave.addEventListener('click', submitComposer);
    const compCancel = createEl(doc, 'button', 'gopt-btn-ghost', 'Cancel');
    compCancel.type = 'button';
    compCancel.addEventListener('click', cancelComposer);
    compActions.appendChild(compSave);
    compActions.appendChild(compCancel);

    const compFoot = createEl(doc, 'div', 'gopt-composer-foot');
    compFoot.appendChild(compDots);
    compFoot.appendChild(compActions);
    composer.appendChild(compInput);
    composer.appendChild(compFoot);

    const bodyEl = createEl(doc, 'div', 'gopt-folders-body gopt-acc is-open');
    const bodyInner = createEl(doc, 'div', 'gopt-acc-inner');
    const listEl = createEl(doc, 'div', 'gopt-folders-list');
    bodyInner.appendChild(composer);
    bodyInner.appendChild(listEl);
    bodyEl.appendChild(bodyInner);
    sec.appendChild(bodyEl);

    const div = createEl(doc, 'div', 'gopt-folders-divider');
    div.setAttribute('data-gopt-owned', '');
    div.setAttribute('aria-hidden', 'true');

    S.sectionEl = sec;
    S.dividerEl = div;
    S.toggleBtn = toggleBtn;
    S.assignCurBtn = assignCurBtn;
    S.addBtn = addBtn;
    S.composerEl = composer;
    S.composerInput = compInput;
    S.bodyEl = bodyEl;
    S.listEl = listEl;
  }

  function mountSectionInSidenav() {
    const doc = S.doc;
    const Svc = Sel();
    if (!doc || !Svc) return false;
    if (!S.enabled) {
      if (S.sectionEl && S.sectionEl.remove) S.sectionEl.remove();
      if (S.dividerEl && S.dividerEl.remove) S.dividerEl.remove();
      return false;
    }

    const notebookSec = Svc.findNotebookSection(doc);
    const chatsSec = Svc.findChatsSection(doc);
    const scroller = Svc.findSidenavScroller(doc);
    const anchor = (notebookSec && notebookSec.parentNode) ? notebookSec
      : ((chatsSec && chatsSec.parentNode) ? chatsSec : null);

    if (!anchor && !scroller) return false;
    ensureSectionDom();

    if (anchor && anchor.parentNode) {
      const parent = anchor.parentNode;
      const misordered = 'nextSibling' in S.sectionEl &&
        (S.sectionEl.nextSibling !== S.dividerEl || S.dividerEl.nextSibling !== anchor);
      if (S.sectionEl.parentNode !== parent || S.dividerEl.parentNode !== parent || misordered) {
        parent.insertBefore(S.sectionEl, anchor);
        parent.insertBefore(S.dividerEl, anchor);
      }
      return true;
    }

    if (scroller) {
      if (S.sectionEl.parentNode !== scroller) {
        if (typeof scroller.prepend === 'function') {
          scroller.prepend(S.dividerEl);
          scroller.prepend(S.sectionEl);
        } else {
          scroller.insertBefore(S.sectionEl, scroller.firstChild || null);
          scroller.insertBefore(S.dividerEl, S.sectionEl.nextSibling || null);
        }
      }
      return true;
    }
    return false;
  }

  function navigateToConv(convId, url, ev) {
    const doc = S.doc;
    const Svc = Sel();
    if (doc && Svc) {
      const items = Svc.findSidenavConvItems(doc);
      for (const item of items) {
        if (Svc.extractConvIdFromItem(item) === convId) {
          if (ev && ev.preventDefault) ev.preventDefault();
          const target = (item.querySelector && item.querySelector('a[href*="/app/"], .conversation, [role="button"], button:not([aria-haspopup])')) || item;
          if (target && typeof target.click === 'function') {
            target.click();
            return 'spa';
          }
        }
      }
    }
    const targetUrl = validAppUrl(convId, url);
    if (ev && ev.preventDefault) ev.preventDefault();
    if (root.location && typeof root.location.assign === 'function') {
      root.location.assign(targetUrl);
    }
    return 'url';
  }

  // ---------- section rendering ----------
  function renderSection() {
    if (!S.sectionEl || !S.doc) return;
    const doc = S.doc;
    const curCid = activeConvId();

    const expanded = !S.store.sectionCollapsed;
    S.toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (S.bodyEl.classList) S.bodyEl.classList.toggle('is-open', expanded);
    S.bodyEl.inert = !expanded;
    S.bodyEl.setAttribute('aria-hidden', expanded ? 'false' : 'true');
    S.assignCurBtn.hidden = !curCid;
    S.composerEl.hidden = !S.composerOpen;

    const sig = JSON.stringify({
      f: S.store.folders,
      c: S.store.convs,
      cur: curCid,
      ren: S.renamingFolderId,
      comp: S.composerOpen
    });
    if (sig === S.lastRenderSig) return;
    S.lastRenderSig = sig;

    while (S.listEl.firstChild) S.listEl.removeChild(S.listEl.firstChild);

    if (S.store.folders.length === 0) {
      S.listEl.appendChild(createEl(doc, 'div', 'gopt-folders-empty', 'No folders yet'));
      return;
    }

    for (const folder of S.store.folders) {
      const fExpanded = !folder.collapsed;
      const card = createEl(doc, 'div', 'gopt-folder-card' + (fExpanded ? ' is-expanded' : ''));
      card.setAttribute('data-folder-id', folder.id);
      applyColorAttr(card, folder.color);

      const row = createEl(doc, 'div', 'gopt-folder-row');
      const isRenaming = S.renamingFolderId === folder.id;

      if (isRenaming) {
        const renameWrap = createEl(doc, 'div', 'gopt-folder-rename-wrap');
        const dot = createEl(doc, 'span', 'gopt-folder-dot');
        dot.setAttribute('aria-hidden', 'true');
        applyDotColor(dot, folder.color);
        const input = createEl(doc, 'input', 'gopt-folder-rename-input');
        input.type = 'text';
        input.maxLength = MAX_NAME_LEN;
        input.value = folder.name;
        input.setAttribute('aria-label', 'Rename folder');
        const finishRename = function (save) {
          if (S.renamingFolderId !== folder.id) return;
          const nextName = cleanStr(input.value, MAX_NAME_LEN);
          S.renamingFolderId = null;
          if (save && nextName && nextName !== folder.name) {
            commitStore(renameFolder(S.store, folder.id, nextName));
          } else {
            S.lastRenderSig = '';
            renderSection();
          }
        };
        input.addEventListener('keydown', function (ev) {
          if (!ev) return;
          if (ev.key === 'Enter') {
            if (ev.preventDefault) ev.preventDefault();
            finishRename(true);
          } else if (ev.key === 'Escape') {
            if (ev.preventDefault) ev.preventDefault();
            finishRename(false);
          }
        });
        input.addEventListener('blur', function () { finishRename(true); });
        renameWrap.appendChild(dot);
        renameWrap.appendChild(input);
        row.appendChild(renameWrap);
        S.listEl.appendChild(card);
        card.appendChild(row);
        if (input.focus) {
          root.setTimeout(function () {
            if (isAttached(input) && input.focus) {
              input.focus();
              if (input.select) input.select();
            }
          }, 0);
        }
        continue;
      }

      const mainBtn = createEl(doc, 'button', 'gopt-folder-main');
      mainBtn.type = 'button';
      mainBtn.setAttribute('aria-expanded', fExpanded ? 'true' : 'false');
      mainBtn.appendChild(createSvg(doc, 13, ['M6 9l6 6 6-6']));
      const dot = createEl(doc, 'span', 'gopt-folder-dot');
      dot.setAttribute('aria-hidden', 'true');
      applyDotColor(dot, folder.color);
      mainBtn.appendChild(dot);
      mainBtn.appendChild(createEl(doc, 'span', 'gopt-folder-name', folder.name));
      mainBtn.addEventListener('click', function () {
        commitStore(toggleFolderCollapsed(S.store, folder.id));
      });

      const menuBtn = createEl(doc, 'button', 'gopt-folder-menu-btn');
      menuBtn.type = 'button';
      menuBtn.setAttribute('aria-label', 'Options for ' + folder.name);
      menuBtn.setAttribute('aria-haspopup', 'menu');
      menuBtn.setAttribute('aria-expanded', (S.menuOpen && S.menuFolderId === folder.id) ? 'true' : 'false');
      menuBtn.appendChild(createSvg(doc, 14, null, [[12, 5, 1.6], [12, 12, 1.6], [12, 19, 1.6]]));
      menuBtn.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        if (S.menuOpen && S.menuFolderId === folder.id) closeMenu();
        else openMenu(menuBtn, folder.id);
      });

      row.appendChild(mainBtn);
      row.appendChild(menuBtn);
      card.appendChild(row);

      const chatsAcc = createEl(doc, 'div', 'gopt-folder-chats gopt-acc' + (fExpanded ? ' is-open' : ''));
      chatsAcc.inert = !fExpanded;
      chatsAcc.setAttribute('aria-hidden', fExpanded ? 'false' : 'true');
      const chatsInner = createEl(doc, 'div', 'gopt-acc-inner');
      const chatsList = createEl(doc, 'div', 'gopt-folder-chats-list');

      if (folder.convIds.length === 0) {
        chatsList.appendChild(createEl(doc, 'div', 'gopt-folder-chats-empty', 'Empty folder'));
      } else {
        for (const cid of folder.convIds) {
          const meta = S.store.convs[cid] || { id: cid, title: 'Untitled chat', url: 'https://gemini.google.com/app/' + cid };
          const itemRow = createEl(doc, 'div', 'gopt-folder-chat-item' + (cid === curCid ? ' is-active' : ''));
          itemRow.setAttribute('data-conv-id', cid);

          const link = createEl(doc, 'a', 'gopt-folder-chat-link');
          link.href = meta.url;
          link.title = meta.title;
          link.appendChild(createSvg(doc, 13, ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z']));
          link.appendChild(createEl(doc, 'span', 'gopt-folder-chat-title', meta.title));
          link.addEventListener('click', function (ev) {
            navigateToConv(cid, meta.url, ev);
          });

          const rmBtn = createEl(doc, 'button', 'gopt-folder-chat-remove');
          rmBtn.type = 'button';
          rmBtn.setAttribute('aria-label', 'Remove from folder');
          rmBtn.title = 'Remove from folder';
          rmBtn.appendChild(createSvg(doc, 12, ['M18 6L6 18', 'M6 6l12 12']));
          rmBtn.addEventListener('click', function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            commitStore(removeConvFromFolders(S.store, cid));
          });

          itemRow.appendChild(link);
          itemRow.appendChild(rmBtn);
          chatsList.appendChild(itemRow);
        }
      }

      chatsInner.appendChild(chatsList);
      chatsAcc.appendChild(chatsInner);
      card.appendChild(chatsAcc);
      S.listEl.appendChild(card);
    }
  }

  // ---------- shared popovers (.gopt-folder-menu, .gopt-folder-picker, .gopt-conv-folder-btn) ----------
  function placePopover(popEl, anchorEl, estW, estH) {
    if (!popEl || !anchorEl || !anchorEl.getBoundingClientRect) return;
    const vw = root.innerWidth || 1200;
    const vh = root.innerHeight || 800;
    const ar = anchorEl.getBoundingClientRect();
    let left = Math.round(ar.right + 6);
    if (left + estW > vw - 8) left = Math.round(ar.left - estW - 6);
    if (left < 8) left = Math.max(8, Math.round(Math.min(vw - estW - 8, ar.left)));
    let top = Math.round(ar.top);
    if (top + estH > vh - 8) top = Math.max(8, vh - estH - 8);
    if (top < 8) top = 8;
    popEl.style.left = left + 'px';
    popEl.style.top = top + 'px';
  }

  function clearDeleteConfirm() {
    root.clearTimeout(S.deleteConfirmTimer);
    S.deleteConfirmTimer = 0;
    S.deleteConfirmFolderId = null;
  }

  function closeMenu() {
    const prevBtn = S.menuAnchorEl;
    clearDeleteConfirm();
    S.menuOpen = false;
    S.menuFolderId = null;
    S.menuAnchorEl = null;
    if (prevBtn && prevBtn.setAttribute) prevBtn.setAttribute('aria-expanded', 'false');
    if (S.menuEl && S.menuEl.classList) {
      S.menuEl.classList.remove('is-open');
      S.menuEl.hidden = true;
    }
  }

  function openMenu(anchorEl, folderId) {
    closePicker();
    if (S.menuAnchorEl && S.menuAnchorEl !== anchorEl && S.menuAnchorEl.setAttribute) {
      S.menuAnchorEl.setAttribute('aria-expanded', 'false');
    }
    clearDeleteConfirm();
    ensurePortals();
    S.menuOpen = true;
    S.menuFolderId = folderId;
    S.menuAnchorEl = anchorEl;
    if (anchorEl && anchorEl.setAttribute) anchorEl.setAttribute('aria-expanded', 'true');
    renderMenu();
    if (S.menuEl) {
      S.menuEl.hidden = false;
      placePopover(S.menuEl, anchorEl, 208, 152);
      if (S.menuEl.classList) S.menuEl.classList.add('is-open');
    }
  }

  function renderMenu() {
    if (!S.menuEl || !S.doc || !S.menuOpen) return;
    const doc = S.doc;
    const folder = S.store.folders.find(function (f) { return f.id === S.menuFolderId; });
    if (!folder) {
      closeMenu();
      return;
    }
    while (S.menuEl.firstChild) S.menuEl.removeChild(S.menuEl.firstChild);

    // 1. Rename
    const renameBtn = createEl(doc, 'button', 'gopt-menu-item is-rename');
    renameBtn.type = 'button';
    renameBtn.setAttribute('role', 'menuitem');
    renameBtn.appendChild(createSvg(doc, 14, ['M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z']));
    renameBtn.appendChild(createEl(doc, 'span', null, 'Rename'));
    renameBtn.addEventListener('click', function () {
      const fid = folder.id;
      closeMenu();
      S.renamingFolderId = fid;
      S.lastRenderSig = '';
      renderSection();
    });
    S.menuEl.appendChild(renameBtn);

    // 2. Delete (1-click empty; 2-click confirm non-empty)
    const confirming = S.deleteConfirmFolderId === folder.id;
    const delBtn = createEl(doc, 'button', 'gopt-menu-item is-danger' + (confirming ? ' is-confirm' : ''));
    delBtn.type = 'button';
    delBtn.setAttribute('role', 'menuitem');
    if (confirming) delBtn.setAttribute('data-confirm', '1');
    delBtn.appendChild(createSvg(doc, 14, ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2']));
    delBtn.appendChild(createEl(doc, 'span', null, confirming ? 'Click again to confirm' : 'Delete'));
    delBtn.addEventListener('click', function () {
      if (folder.convIds.length === 0 || S.deleteConfirmFolderId === folder.id) {
        const fid = folder.id;
        closeMenu();
        commitStore(deleteFolder(S.store, fid));
        return;
      }
      clearDeleteConfirm();
      S.deleteConfirmFolderId = folder.id;
      S.deleteConfirmTimer = root.setTimeout(function () {
        S.deleteConfirmTimer = 0;
        S.deleteConfirmFolderId = null;
        if (S.menuOpen) renderMenu();
      }, DELETE_CONFIRM_MS);
      renderMenu();
    });
    S.menuEl.appendChild(delBtn);

    // 3. Color picker (6 presets + Custom color last; live custom scrubbing does NOT tear down menuEl)
    const applyLiveColor = function (nextColor, immediate) {
      S.store = setFolderColor(S.store, folder.id, nextColor);
      S.lastRenderSig = '';
      if (immediate) {
        S.dirtyStore = true;
        flushPersist();
      } else {
        schedulePersist();
      }
      renderSection();
      syncSidebar();
      if (S.pickerOpen) renderPicker();
    };
    const palette = buildColorSwatchRow(
      doc,
      'gopt-menu-colors',
      function () { return folder.color; },
      function (c) { applyLiveColor(c, false); },
      function (hex) { applyLiveColor(hex, false); },
      function (hex) { applyLiveColor(hex, true); }
    );
    S.menuEl.appendChild(palette.row);
  }

  function closePicker() {
    S.pickerOpen = false;
    S.pickerAnchorEl = null;
    S.pickerConvId = '';
    S.pickerConvTitle = '';
    S.pickerConvUrl = '';
    S.pickerAdding = false;
    if (S.pickerEl && S.pickerEl.classList) {
      S.pickerEl.classList.remove('is-open');
      S.pickerEl.hidden = true;
    }
    scheduleHoverHide();
  }

  function openPicker(anchorEl, info) {
    closeMenu();
    ensurePortals();
    clearHoverHideTimer();
    const cid = normConvId(info && info.convId);
    if (!cid) return;
    S.pickerOpen = true;
    S.pickerAnchorEl = anchorEl;
    S.pickerConvId = cid;
    S.pickerConvTitle = cleanStr(info.title, 140) || 'Untitled chat';
    S.pickerConvUrl = validAppUrl(cid, info.url);
    S.pickerAdding = false;
    renderPicker();
    if (S.pickerEl) {
      S.pickerEl.hidden = false;
      placePopover(S.pickerEl, anchorEl, 232, 260);
      if (S.pickerEl.classList) S.pickerEl.classList.add('is-open');
    }
  }

  function renderPicker() {
    if (!S.pickerEl || !S.doc || !S.pickerOpen) return;
    const doc = S.doc;
    while (S.pickerEl.firstChild) S.pickerEl.removeChild(S.pickerEl.firstChild);

    const head = createEl(doc, 'div', 'gopt-picker-head');
    head.appendChild(createEl(doc, 'span', 'gopt-picker-title', 'Move to folder'));
    head.appendChild(createEl(doc, 'span', 'gopt-picker-sub', S.pickerConvTitle));
    S.pickerEl.appendChild(head);

    const assignedFolder = findFolderForConv(S.store, S.pickerConvId);
    const list = createEl(doc, 'div', 'gopt-picker-list');
    if (S.store.folders.length === 0) {
      list.appendChild(createEl(doc, 'div', 'gopt-picker-empty', 'No folders yet'));
    } else {
      for (const f of S.store.folders) {
        const isHere = !!(assignedFolder && assignedFolder.id === f.id);
        const btn = createEl(doc, 'button', 'gopt-picker-item' + (isHere ? ' is-selected' : ''));
        btn.type = 'button';
        applyColorAttr(btn, f.color);
        const dot = createEl(doc, 'span', 'gopt-folder-dot');
        dot.setAttribute('aria-hidden', 'true');
        applyDotColor(dot, f.color);
        btn.appendChild(dot);
        btn.appendChild(createEl(doc, 'span', 'gopt-picker-name', f.name));
        if (isHere) btn.appendChild(createSvg(doc, 13, ['M20 6L9 17l-5-5']));
        btn.addEventListener('click', function () {
          const cid = S.pickerConvId;
          const title = S.pickerConvTitle;
          const url = S.pickerConvUrl;
          closePicker();
          if (isHere) {
            commitStore(removeConvFromFolders(S.store, cid));
          } else {
            commitStore(assignConvToFolder(S.store, {
              folderId: f.id,
              convId: cid,
              title: title,
              url: url
            }));
          }
        });
        list.appendChild(btn);
      }
    }
    S.pickerEl.appendChild(list);

    const foot = createEl(doc, 'div', 'gopt-picker-foot');
    if (!S.pickerAdding) {
      const newBtn = createEl(doc, 'button', 'gopt-picker-new-btn');
      newBtn.type = 'button';
      newBtn.appendChild(createSvg(doc, 13, ['M12 5v14', 'M5 12h14']));
      newBtn.appendChild(createEl(doc, 'span', null, 'New folder'));
      newBtn.addEventListener('click', function () {
        S.pickerAdding = true;
        renderPicker();
      });
      foot.appendChild(newBtn);
    } else {
      const form = createEl(doc, 'div', 'gopt-picker-create');
      const input = createEl(doc, 'input', 'gopt-folder-input');
      input.type = 'text';
      input.maxLength = MAX_NAME_LEN;
      input.placeholder = 'New folder name...';
      input.setAttribute('aria-label', 'New folder name');
      const submitNew = function () {
        const name = cleanStr(input.value, MAX_NAME_LEN);
        if (!name) return;
        const created = createFolder(S.store, { name: name, color: S.pickerNewColor });
        const createdFolder = created.folders[created.folders.length - 1];
        const cid = S.pickerConvId;
        const title = S.pickerConvTitle;
        const url = S.pickerConvUrl;
        closePicker();
        if (createdFolder) {
          commitStore(assignConvToFolder(created, {
            folderId: createdFolder.id,
            convId: cid,
            title: title,
            url: url
          }));
        }
      };
      input.addEventListener('keydown', function (ev) {
        if (!ev) return;
        if (ev.key === 'Enter') {
          if (ev.preventDefault) ev.preventDefault();
          submitNew();
        } else if (ev.key === 'Escape') {
          if (ev.preventDefault) ev.preventDefault();
          S.pickerAdding = false;
          renderPicker();
        }
      });
      const addAction = createEl(doc, 'button', 'gopt-btn-primary', 'Add');
      addAction.type = 'button';
      addAction.addEventListener('click', submitNew);
      form.appendChild(input);
      form.appendChild(addAction);
      foot.appendChild(form);
      if (input.focus) {
        root.setTimeout(function () { if (isAttached(input)) input.focus(); }, 0);
      }
    }
    S.pickerEl.appendChild(foot);
  }

  function clearHoverHideTimer() {
    root.clearTimeout(S.hoverHideTimer);
    S.hoverHideTimer = 0;
  }

  function hideHoverBtnNow() {
    clearHoverHideTimer();
    S.hoverItem = null;
    S.hoverConvId = '';
    S.hoverConvTitle = '';
    if (S.hoverBtn && S.hoverBtn.classList) {
      S.hoverBtn.classList.remove('is-visible');
      S.hoverBtn.hidden = true;
    }
  }

  function scheduleHoverHide() {
    if (S.pickerOpen) return;
    clearHoverHideTimer();
    S.hoverHideTimer = root.setTimeout(function () {
      S.hoverHideTimer = 0;
      if (!S.pickerOpen) hideHoverBtnNow();
    }, HOVER_HIDE_GRACE_MS);
  }

  function showHoverBtnForItem(itemEl) {
    const Svc = Sel();
    if (!S.enabled || !S.mounted || !Svc || !itemEl) return;
    if (itemEl.getAttribute && itemEl.getAttribute('data-gopt-in-folder') === '1') return;
    if (!itemEl.getBoundingClientRect) return;
    const rect = itemEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const cid = Svc.extractConvIdFromItem(itemEl);
    if (!cid) return;

    ensurePortals();
    clearHoverHideTimer();
    S.hoverItem = itemEl;
    S.hoverConvId = cid;
    S.hoverConvTitle = Svc.extractConvTitle(itemEl) || 'Untitled chat';

    const vw = root.innerWidth || 1200;
    const vh = root.innerHeight || 800;
    const left = Math.max(8, Math.min(vw - 34, Math.round(rect.right - 64)));
    const top = Math.max(8, Math.min(vh - 34, Math.round(rect.top + (rect.height - 26) / 2)));

    S.hoverBtn.style.left = left + 'px';
    S.hoverBtn.style.top = top + 'px';
    S.hoverBtn.hidden = false;
    const assigned = findFolderForConv(S.store, cid);
    if (S.hoverBtn.classList) {
      S.hoverBtn.classList.toggle('is-assigned', !!assigned);
      S.hoverBtn.classList.add('is-visible');
    }
    if (assigned) {
      applyColorAttr(S.hoverBtn, assigned.color);
      S.hoverBtn.style.color = isCustomColor(assigned.color) ? assigned.color : '';
      S.hoverBtn.style.borderColor = isCustomColor(assigned.color) ? assigned.color : '';
    } else {
      S.hoverBtn.removeAttribute('data-color');
      S.hoverBtn.style.color = '';
      S.hoverBtn.style.borderColor = '';
    }
  }

  function ensurePortals() {
    const doc = S.doc;
    if (!doc || !doc.body) return;
    if (!S.hoverBtn) {
      const btn = createEl(doc, 'button', 'gopt-conv-folder-btn');
      btn.type = 'button';
      btn.hidden = true;
      btn.setAttribute('data-gopt-owned', '');
      btn.setAttribute('aria-label', 'Move chat to folder');
      btn.title = 'Move to folder';
      btn.appendChild(createSvg(doc, 14, ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']));
      btn.addEventListener('pointerenter', clearHoverHideTimer);
      btn.addEventListener('pointerleave', scheduleHoverHide);
      btn.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        if (!S.hoverConvId) return;
        openPicker(btn, {
          convId: S.hoverConvId,
          title: S.hoverConvTitle,
          url: 'https://gemini.google.com/app/' + S.hoverConvId
        });
      });
      doc.body.appendChild(btn);
      S.hoverBtn = btn;
    }
    if (!S.pickerEl) {
      const picker = createEl(doc, 'div', 'gopt-folder-picker');
      picker.hidden = true;
      picker.setAttribute('data-gopt-owned', '');
      picker.setAttribute('role', 'dialog');
      picker.setAttribute('aria-label', 'Select folder');
      picker.addEventListener('pointerenter', clearHoverHideTimer);
      doc.body.appendChild(picker);
      S.pickerEl = picker;
    }
    if (!S.menuEl) {
      const menu = createEl(doc, 'div', 'gopt-folder-menu');
      menu.hidden = true;
      menu.setAttribute('data-gopt-owned', '');
      menu.setAttribute('role', 'menu');
      doc.body.appendChild(menu);
      S.menuEl = menu;
    }
  }

  // ---------- sidebar scanning, listeners & lifecycle ----------
  const CONV_ITEM_MATCH = 'gem-nav-list-item[data-test-id="conversation"], [data-test-id="conversation"][data-conversation-id], [data-conversation-id], a[href*="/app/"]';

  function findHoveredItemFromEvent(ev) {
    const t = ev && ev.target;
    if (!t || !t.closest) return null;
    if (t.closest('[data-gopt-owned]') !== null) return null;
    const item = t.closest(CONV_ITEM_MATCH);
    if (!item || (item.closest && item.closest('[data-gopt-owned]') !== null)) return null;
    return item;
  }

  function onSidenavPointerOver(ev) {
    const item = findHoveredItemFromEvent(ev);
    if (item) showHoverBtnForItem(item);
    else if (S.hoverBtn && ev && ev.target && (!ev.target.closest || !ev.target.closest('.gopt-conv-folder-btn, .gopt-folder-picker'))) {
      scheduleHoverHide();
    }
  }

  function onSidenavScroll() {
    hideHoverBtnNow();
    if (S.pickerOpen) closePicker();
    if (S.menuOpen) closeMenu();
  }

  function bindSidenavListeners() {
    const doc = S.doc;
    const Svc = Sel();
    if (!doc || !Svc) return;

    const nav = Svc.queryFirst(doc, Svc.SEL.sidenav);
    const scroller = Svc.findSidenavScroller(doc);

    if (nav !== S.sidenavEl) {
      if (S.sidenavEl && S.sidenavEl.removeEventListener) {
        S.sidenavEl.removeEventListener('pointerover', onSidenavPointerOver);
        S.sidenavEl.removeEventListener('pointerleave', scheduleHoverHide);
        S.sidenavEl.removeEventListener('focusin', onSidenavPointerOver);
      }
      if (S.mo) { S.mo.disconnect(); S.mo = null; }
      S.sidenavEl = nav || null;
      if (S.sidenavEl && S.sidenavEl.addEventListener) {
        S.sidenavEl.addEventListener('pointerover', onSidenavPointerOver, { passive: true });
        S.sidenavEl.addEventListener('pointerleave', scheduleHoverHide, { passive: true });
        S.sidenavEl.addEventListener('focusin', onSidenavPointerOver, { passive: true });
      }
    }

    if (scroller !== S.scrollEl) {
      if (S.scrollEl && S.scrollEl.removeEventListener) {
        S.scrollEl.removeEventListener('scroll', onSidenavScroll);
      }
      S.scrollEl = scroller || null;
      if (S.scrollEl && S.scrollEl.addEventListener) {
        S.scrollEl.addEventListener('scroll', onSidenavScroll, { passive: true });
      }
    }

    const observeTarget = S.sidenavEl || doc.body || doc.documentElement;
    if (observeTarget && !S.mo && typeof root.MutationObserver === 'function') {
      S.mo = new root.MutationObserver(onSidenavMutations);
      S.mo.observe(observeTarget, { childList: true, subtree: true });
    }
  }

  function isOwnedNode(node) {
    if (!node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    if (el.hasAttribute && el.hasAttribute('data-gopt-owned')) return true;
    return !!(el.closest && el.closest('[data-gopt-owned]') !== null);
  }

  function onSidenavMutations(records) {
    let external = false;
    for (const r of records) {
      for (const n of r.addedNodes || []) {
        if (!isOwnedNode(n)) { external = true; break; }
      }
      if (external) break;
      for (const n of r.removedNodes || []) {
        if (!isOwnedNode(n)) { external = true; break; }
      }
      if (external) break;
    }
    if (!external) return;
    root.clearTimeout(S.moTimer);
    S.moTimer = root.setTimeout(function () {
      S.moTimer = 0;
      syncSidebar();
    }, OBSERVER_DEBOUNCE_MS);
  }

  function syncConvStamps(items) {
    const Svc = Sel();
    if (!Svc) return;
    const assigned = S.enabled ? getAssignedConvSet(S.store) : new Set();
    const activeItems = new Set();

    for (const item of items) {
      const cid = Svc.extractConvIdFromItem(item);
      if (!cid) continue;
      if (assigned.has(cid)) {
        item.setAttribute('data-gopt-in-folder', '1');
        S.stampedItems.add(item);
        activeItems.add(item);
      } else if (item.removeAttribute) {
        item.removeAttribute('data-gopt-in-folder');
        S.stampedItems.delete(item);
      }
    }

    for (const prevEl of Array.from(S.stampedItems)) {
      if (!activeItems.has(prevEl)) {
        if (prevEl && prevEl.removeAttribute) prevEl.removeAttribute('data-gopt-in-folder');
        S.stampedItems.delete(prevEl);
      }
    }
  }

  function syncSidebar() {
    if (!S.mounted || !S.doc) return;
    const Svc = Sel();
    if (!Svc) return;

    bindSidenavListeners();
    mountSectionInSidenav();
    if (S.enabled && !S.renamingFolderId && !S.composerOpen) renderSection();

    const items = Svc.findSidenavConvItems(S.doc);
    syncConvStamps(items);

    const titleMap = {};
    if (S.enabled) {
      for (const item of items) {
        const cid = Svc.extractConvIdFromItem(item);
        if (!cid || !S.store.convs[cid]) continue;
        titleMap[cid] = {
          title: Svc.extractConvTitle(item),
          url: 'https://gemini.google.com/app/' + cid
        };
      }
    }

    if (S.enabled && Object.keys(titleMap).length > 0) {
      const synced = syncConvTitles(S.store, titleMap);
      if (synced.changed) {
        S.store = synced.store;
        schedulePersist();
        if (!S.renamingFolderId && !S.composerOpen) {
          S.lastRenderSig = '';
          renderSection();
        }
      }
    }
  }

  function attachGlobalListeners() {
    const doc = S.doc;
    if (!doc || !doc.addEventListener) return;
    if (!S.docPointerListener) {
      S.docPointerListener = function (ev) {
        const t = ev && ev.target;
        if (S.pickerOpen && S.pickerEl) {
          const inPicker = t && t.closest && t.closest('.gopt-folder-picker, .gopt-conv-folder-btn, .gopt-assign-current-btn');
          if (!inPicker) closePicker();
        }
        if (S.menuOpen && S.menuEl) {
          const inMenu = t && t.closest && t.closest('.gopt-folder-menu, .gopt-folder-menu-btn');
          if (!inMenu) closeMenu();
        }
      };
      doc.addEventListener('pointerdown', S.docPointerListener, { passive: true });
    }
    if (!S.docKeyListener) {
      S.docKeyListener = function (ev) {
        if (!ev || ev.key !== 'Escape') return;
        if (S.pickerOpen) { closePicker(); return; }
        if (S.menuOpen) { closeMenu(); return; }
        if (S.composerOpen) {
          S.composerOpen = false;
          S.lastRenderSig = '';
          renderSection();
        }
      };
      doc.addEventListener('keydown', S.docKeyListener);
    }
  }

  function attachStorageListener() {
    const api = root.chrome && root.chrome.storage;
    if (!api || !api.onChanged || typeof api.onChanged.addListener !== 'function' || S.storageListener) return;
    S.storageListener = function (changes, areaName) {
      if (areaName !== 'local' || !changes || !(STORAGE_KEY in changes)) return;
      const next = normalizeFolderStore(changes[STORAGE_KEY].newValue);
      if (JSON.stringify(next) === JSON.stringify(S.store)) {
        S.storeLoaded = true;
        return;
      }
      S.store = next;
      S.storeLoaded = true;
      if (!S.mounted) return;
      if (S.renamingFolderId || S.composerOpen) {
        const Svc = Sel();
        if (Svc && S.doc) syncConvStamps(Svc.findSidenavConvItems(S.doc));
      } else {
        S.lastRenderSig = '';
        syncSidebar();
      }
      if (S.pickerOpen && !S.pickerAdding) renderPicker();
      if (S.menuOpen) renderMenu();
    };
    api.onChanged.addListener(S.storageListener);
  }

  function loadStore() {
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
        if (S.dirtyStore) {
          S.storeLoaded = true;
          return;
        }
        S.store = normalizeFolderStore(res && res[STORAGE_KEY]);
        S.storeLoaded = true;
        S.lastRenderSig = '';
        if (S.mounted) syncSidebar();
      });
    } catch (_) {
      S.storeLoaded = true;
    }
  }

  function mount(doc) {
    S.doc = doc || root.document;
    if (!S.doc || S.mounted) return;
    S.mounted = true;
    S.currentUrl = root.location ? root.location.href : '';
    attachStorageListener();
    attachGlobalListeners();
    loadStore();
    if (S.enabled) {
      ensureSectionDom();
      ensurePortals();
    }
    syncSidebar();
  }

  function setEnabled(on) {
    const next = !!on;
    if (S.enabled === next && S.mounted) return;
    S.enabled = next;
    if (!S.enabled) {
      closePicker();
      closeMenu();
      hideHoverBtnNow();
      S.composerOpen = false;
      S.renamingFolderId = null;
      clearStampedItems();
      if (S.sectionEl && S.sectionEl.remove) S.sectionEl.remove();
      if (S.dividerEl && S.dividerEl.remove) S.dividerEl.remove();
    } else if (S.mounted) {
      S.lastRenderSig = '';
      ensureSectionDom();
      ensurePortals();
      syncSidebar();
    }
  }

  function updateRoute(url) {
    S.currentUrl = typeof url === 'string' ? url : (root.location ? root.location.href : '');
    S.renamingFolderId = null;
    closePicker();
    closeMenu();
    hideHoverBtnNow();
    S.lastRenderSig = '';
    if (S.mounted) syncSidebar();
  }

  function destroy() {
    S.mounted = false;
    flushPersist();
    clearDeleteConfirm();
    clearHoverHideTimer();
    root.clearTimeout(S.moTimer); S.moTimer = 0;
    if (S.mo) { S.mo.disconnect(); S.mo = null; }
    if (S.sidenavEl && S.sidenavEl.removeEventListener) {
      S.sidenavEl.removeEventListener('pointerover', onSidenavPointerOver);
      S.sidenavEl.removeEventListener('pointerleave', scheduleHoverHide);
      S.sidenavEl.removeEventListener('focusin', onSidenavPointerOver);
    }
    if (S.scrollEl && S.scrollEl.removeEventListener) {
      S.scrollEl.removeEventListener('scroll', onSidenavScroll);
    }
    S.sidenavEl = null;
    S.scrollEl = null;

    if (S.doc && S.doc.removeEventListener) {
      if (S.docPointerListener) S.doc.removeEventListener('pointerdown', S.docPointerListener);
      if (S.docKeyListener) S.doc.removeEventListener('keydown', S.docKeyListener);
    }
    S.docPointerListener = null;
    S.docKeyListener = null;

    const api = root.chrome && root.chrome.storage;
    if (S.storageListener && api && api.onChanged && typeof api.onChanged.removeListener === 'function') {
      api.onChanged.removeListener(S.storageListener);
    }
    S.storageListener = null;

    clearStampedItems();
    if (S.sectionEl && S.sectionEl.remove) S.sectionEl.remove();
    if (S.dividerEl && S.dividerEl.remove) S.dividerEl.remove();
    if (S.hoverBtn && S.hoverBtn.remove) S.hoverBtn.remove();
    if (S.pickerEl && S.pickerEl.remove) S.pickerEl.remove();
    if (S.menuEl && S.menuEl.remove) S.menuEl.remove();

    S.sectionEl = S.dividerEl = S.toggleBtn = S.assignCurBtn = S.addBtn = null;
    S.composerEl = S.composerInput = S.bodyEl = S.listEl = null;
    S.hoverBtn = S.pickerEl = S.menuEl = null;
    S.hoverItem = null; S.hoverConvId = ''; S.hoverConvTitle = '';
    S.pickerOpen = false; S.menuOpen = false; S.composerOpen = false; S.renamingFolderId = null;
    S.doc = null;
    S.lastRenderSig = '';
    S.store = normalizeFolderStore(null);
    S.storeLoaded = false;
  }

  return Object.freeze({
    STORAGE_KEY, FOLDER_COLORS, MAX_NAME_LEN, DELETE_CONFIRM_MS,
    isCustomColor, normalizeFolderStore, createFolder, renameFolder, setFolderColor,
    toggleFolderCollapsed, toggleSectionCollapsed, deleteFolder,
    assignConvToFolder, removeConvFromFolders, syncConvTitles,
    findFolderForConv, getAssignedConvSet,
    mount, setEnabled, updateRoute, destroy
  });
});
