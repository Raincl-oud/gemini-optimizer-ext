<div align="center">

<img src="icons/icon128.png" width="84" height="84" alt="Gemini Web Optimizer logo" />

# Gemini Web Optimizer

**Organize chats into folders, track official usage & context tokens, and keep long or LaTeX-heavy Gemini conversations 60fps smooth — without breaking Angular or native controls.**

[![CI](https://github.com/Raincl-oud/gemini-optimizer-ext/actions/workflows/ci.yml/badge.svg)](https://github.com/Raincl-oud/gemini-optimizer-ext/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.33.38-0b57d0?style=flat)](VERSION.md)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-0b57d0?style=flat)](manifest.json)
[![Browsers](https://img.shields.io/badge/browsers-Chromium%20Based%20Browsers-334155?style=flat)](#installation)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-16a34a?style=flat)](#development--testing)
[![License: MIT](https://img.shields.io/badge/license-MIT-475569?style=flat)](LICENSE)

<p>
  <a href="#features">Features</a> •
  <a href="#performance-architecture">Performance</a> •
  <a href="#installation">Installation</a> •
  <a href="#privacy--permissions">Privacy</a> •
  <a href="#development--testing">Development</a>
</p>

</div>

---

Long or math-heavy Google Gemini Web threads slow down scrolling, bury reading space under narrow columns and source clutter, and leave chat histories ungrouped. **Gemini Web Optimizer** fixes all of that with a zero-dependency Manifest V3 extension engineered to stay **100% Angular-safe** — it never detaches Angular DOM nodes or breaks native Copy, Edit, Regenerate, Canvas, or *Show thinking* controls.

## Features

| Capability | What It Does |
| :--- | :--- |
| **Conversation Folders** | Adds a native-styled **Folders** section in the Gemini sidebar directly above `Notebook` with 1-chat-per-folder Move semantics, automatic CSS hiding of organized chats from `All`, a zero-mutation hover assign button + `+ Current` quick picker, inline Rename/Delete (1-click empty, 2-click confirm non-empty), 6 preset colors + custom hex color picker, tree indentation, and SPA-first navigation. |
| **Token & Official Usage Bar** | Replaces the bottom disclaimer slot with a compact context token meter and live official `gemini.google.com/usage` **5-hour** & **Weekly** `% used` tracker. Includes a mathematical reset-time solver, provisional fixed-window countdowns (`~5h` / `~7d`) that snap to server time, clickable manual refresh, and scroll-aware post-answer sync. |
| **60fps LaTeX Optimization** | Eliminates heavy-math lag by shielding KaTeX subtrees from DOM/CSS scans, virtualizing off-screen markdown & equation blocks (`content-visibility: auto` with `overflow-clip-margin`), pausing `.markdown` hit-testing during active scroll, automatically engaging **LaTeX Heavy Auto-Guard** (`>= 50` formulas), and offering an optional **Lite LaTeX Render** toggle (hides duplicate `.katex-mathml` while keeping Gemini's Copy button intact). |
| **Wrap Long Chats** | Automatically wraps older turns into compact summary bars while keeping the active turn plus your chosen number of **Open Past Chats** (`0–999`, default `4`) expanded. Manually opened past chats get a dynamic sticky **Wrap** pill. |
| **Left Strip Navigator** | 1:1 scrollable strip rail along the left edge of open chats with GPU-only hover magnification, prompt tooltips (`Wrapped` / `Open`), active scroll spy, and click-to-jump auto-expansion. |
| **Adjustable Full Width** | Expands chat content, wrapped bars, and composer between **`60%–100%`** with smooth transitions, automatic **Home / New Chat exemption**, and **Canvas split-pane safety**. |
| **Typography Controls** | Customize **Font Family** (`Default`, `Sans`, `Serif`, `Mono`), **Font Size**, **Line Height**, **Paragraph Spacing**, and **Letter Spacing** independently while keeping code blocks, tables, and KaTeX formulas clean. |
| **Hide Sources & Citations** | Removes inline citation chips, source carousels, and attribution strips while preserving Drive/Gmail cards, normal Markdown links, and *Show thinking*. |
| **Quick Scroll to Bottom** | Adds a clean circular scroll-to-bottom button aligned above the composer and hides duplicate native buttons. |

## Performance Architecture

Built for 50–100+ turn threads and math-heavy chats with hundreds of KaTeX equations without risking Angular state corruption:

| Phase | Mechanism | Effect |
| :--- | :--- | :--- |
| **1. `document_start`** | [early-boot.js](src/content/early-boot.js) reads a synchronous `localStorage` mirror and injects a Selector Level 4 `:not([data-gopt-turn]):nth-last-child(...)` rule + `gopt-lite-latex` class | Holds older turns at `44px` (`content-visibility: hidden`) before first paint — zero scroll jump on hydration |
| **2. `document_end`** | [main.js](src/content/main.js) boots before subresources finish with frame-0 `rAF` cold-load hydration and `requestIdleCallback` attribution deferral | Eliminates startup freeze and skips KaTeX subtrees completely during attribution scanning |
| **3. Intra-Turn Virtualization** | [early-perf.css](src/content/early-perf.css), [ui-overlay.css](src/content/ui-overlay.css), [collapse-manager.js](src/content/collapse-manager.js) | Applies block-level `content-visibility: auto` (`overflow-clip-margin: 12px`) to finished paragraphs & `.math-block` equations, `contain: layout style` to wrapped turns, and lazy/async hints to wrapped images |
| **4. 60fps Scroll Engine** | [strip-navigator.js](src/content/strip-navigator.js), [token-tracker.js](src/content/token-tracker.js), [main.js](src/content/main.js) | Caches rail/button/token geometries across scroll frames, activates a local `[data-gopt-scrolling="1"]` hit-test shield on `.markdown`, and adapts observer debouncing when `>= 50` KaTeX nodes are present |

## Installation

Works on **Google Chrome**, **Microsoft Edge**, **Opera GX**, and other Chromium Manifest V3 browsers.

### Option A — 1-Command PowerShell Install / Update (Windows, Recommended)

Open **PowerShell** and run:

```powershell
irm https://raw.githubusercontent.com/Raincl-oud/gemini-optimizer-ext/main/install.ps1 | iex
```

This downloads and extracts the extension cleanly to `%LOCALAPPDATA%\GeminiWebOptimizer` (no Git required) and copies the folder path to your clipboard. Then complete the one-time unpacked load in your browser:

1. Open `chrome://extensions` (Chrome), `edge://extensions` (Edge), or `opera://extensions` (Opera GX).
2. Turn on **Developer mode**.
3. Click **Load unpacked**, press **`Ctrl+V`**, and select the folder.
4. Open or reload [gemini.google.com](https://gemini.google.com/).

*(Run the same PowerShell command anytime to update in-place, then click **Reload** in your browser's extensions page.)*

### Option B — Download Release or Clone Manually

1. Download the latest `gemini-web-optimizer-v*.zip` from [**Releases**](https://github.com/Raincl-oud/gemini-optimizer-ext/releases) (or run `git clone https://github.com/Raincl-oud/gemini-optimizer-ext.git`).
2. Extract into a permanent folder on your computer.
3. Follow steps **1–4** above to load the folder containing `manifest.json`.

<details>
<summary><strong>How to update after pulling changes</strong></summary>

1. Run `git pull` inside your extension folder (or replace files with a newer release zip).
2. Open `chrome://extensions` (or `edge://extensions` / `opera://extensions`) and click the **Reload** icon on **Gemini Web Optimizer**.
3. Refresh any open Gemini tab.

</details>

## Privacy & Permissions

**100% local execution** — zero telemetry, zero analytics, and zero third-party network requests. All activity stays strictly on `https://gemini.google.com/*`.

| Permission / Storage | Why It's Needed |
| :--- | :--- |
| `host_permissions` (`https://gemini.google.com/*`) | Restricts content scripts strictly to Gemini Web pages. |
| `storage` (`chrome.storage.local`) | Persists your popup settings (`goptSettings`), folder organization (`goptFolders`), and synced official quota snapshot (`goptTokenUsage`) locally across sessions. |
| `localStorage['goptEarly']` *(on `gemini.google.com`)* | Minimal 4-field mirror (`autoCollapse`, `openPastChats`, `hideSources`, `liteLatex`) enabling synchronous `document_start` pre-wrapping and Lite LaTeX rendering. |
| `tabs` | Queries the active Gemini tab for popup status/quick actions (`Open All`, `Wrap Old`, `Top`, `Bottom`), and briefly opens/auto-closes a silent background `gemini.google.com/usage#gopt-sync` tab to sync your official 5h/weekly quota (manually opened `/usage` tabs are never closed). |

## Development & Testing

No bundler, build step, or `npm install` is required — edit files and reload in the browser. Requires **Node.js 18+** to run the automated syntax, unit, mock-DOM, and CSS §11 guardrail test suite (`60` checks):

```bash
node tests/unit-checks.mjs
```

<details>
<summary><strong>Project Structure</strong></summary>

```text
.
├── manifest.json                 # Manifest V3 configuration
├── install.ps1                   # 1-command Windows PowerShell installer & updater
├── icons/                        # Extension icons (16, 48, 128 px)
├── src/
│   ├── background/
│   │   └── usage-sync.js         # MV3 service worker for silent official /usage background sync
│   ├── content/
│   │   ├── early-boot.js         # document_start pre-wrap, Lite LaTeX mirror & cold-load guard
│   │   ├── early-perf.css        # Intra-turn virtualization, scroll shield, full-width & Lite LaTeX CSS
│   │   ├── ui-overlay.css        # Folders UI, summary bars, Wrap pill, strip rail, usage bar & typography
│   │   ├── collapse-manager.js   # Wrap state machine, sticky pill & lazy media deferral
│   │   ├── strip-navigator.js    # Left strip navigator & tooltip portal
│   │   ├── folder-manager.js     # Angular-safe sidebar Conversation Folders, portals & storage sync
│   │   ├── token-tracker.js      # Context token meter, reset-time solver, provisional anchor & /usage scraper
│   │   └── main.js               # Content orchestrator, Auto-Guard, scroll shield & popup bridge
│   ├── popup/                    # Adaptive popup UI (HTML, CSS, JS)
│   └── shared/
│       ├── settings.js           # Settings schema, validation & serialized storage queue
│       └── selectors.js          # Single DOM seam for Gemini LR26 chat & sidebar selectors
├── tests/
│   └── unit-checks.mjs           # Zero-dependency Node syntax, unit, mock-DOM & CSS guardrail suite
├── .github/workflows/ci.yml      # GitHub Actions CI workflow
├── docs/specs/                   # Architecture & design specifications
└── VERSION.md                    # Monotonic release history
```

</details>

## Changelog & License

- Full release history: [VERSION.md](VERSION.md)
- Licensed under the [MIT License](LICENSE)
