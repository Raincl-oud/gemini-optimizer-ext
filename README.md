<div align="center">

<img src="icons/icon128.png" width="84" height="84" alt="Gemini Web Optimizer logo" />

# Gemini Web Optimizer

**Keep long Google Gemini conversations fast, readable, and clutter-free — without breaking Angular or native controls.**

[![CI](https://github.com/Raincl-oud/gemini-optimizer-ext/actions/workflows/ci.yml/badge.svg)](https://github.com/Raincl-oud/gemini-optimizer-ext/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.22.20-0b57d0?style=flat)](VERSION.md)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-0b57d0?style=flat)](manifest.json)
[![Browsers](https://img.shields.io/badge/browsers-Chrome%20%7C%20Edge%20%7C%20Opera%20GX-334155?style=flat)](#installation)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-16a34a?style=flat)](#development--testing)
[![License: MIT](https://img.shields.io/badge/license-MIT-475569?style=flat)](LICENSE)

<p>
  <a href="#features">Features</a> •
  <a href="#cold-load-performance">Performance</a> •
  <a href="#installation">Installation</a> •
  <a href="#privacy--permissions">Privacy</a> •
  <a href="#development--testing">Development</a>
</p>

</div>

---

Long Gemini Web threads slow down the browser, stretch vertical scrolling, and bury your reading area under narrow columns and source clutter. **Gemini Web Optimizer** solves this with a zero-dependency Manifest V3 extension that stays **100% Angular-safe** — it never detaches DOM nodes or breaks native Copy, Edit, Regenerate, Canvas, or *Show thinking* controls.

## Features

| Capability | What It Does |
| :--- | :--- |
| **Wrap Long Chats** | Automatically wraps older turns into compact summary bars while keeping the latest turn plus your chosen number of **Open Past Chats** (`0–999`, default `4`) expanded. Manually opened chats get a dynamic sticky **Wrap** pill. |
| **Cold-Load Acceleration** | Pre-wraps older turns synchronously at `document_start` before Angular paints, runs frame-0 hydration at `document_end`, defers attribution scans to idle time, and marks wrapped images `loading="lazy"` + `decoding="async"`. |
| **Left Strip Navigator** | 1:1 scrollable strip rail along the left edge of open chats with GPU-only hover magnification, prompt tooltips (`Wrapped` / `Open`), active scroll-spy, and click-to-jump auto-expansion. |
| **Adjustable Full Width** | Expand chat content and composer between **`60%–100%`** with smooth toggle transitions, automatic **Home / New Chat exemption**, and **Canvas split-pane safety**. |
| **Typography Controls** | Customize **Font Family** (`Default`, `Sans`, `Serif`, `Mono`), **Font Size**, **Line Height**, **Paragraph Spacing**, and **Letter Spacing** independently — while keeping code blocks and tables clean. |
| **Hide Sources & Citations** | Removes inline citation chips, source carousels, and attribution strips while preserving Drive/Gmail cards, normal Markdown links, and *Show thinking*. |
| **Quick Scroll-to-Bottom** | Adds a clean circular scroll-to-bottom button aligned above the composer and hides duplicate native buttons. |

## Cold-Load Performance

Designed specifically for heavy, 50–100+ turn conversations without risking Angular state corruption:

| Phase | Mechanism | Effect |
| :--- | :--- | :--- |
| **1. `document_start`** | [early-boot.js](src/content/early-boot.js) reads a synchronous `localStorage` settings mirror and injects a Selector Level 4 `:not([data-gopt-turn]):nth-last-child(...)` rule | Older turns are held at `44px` with `content-visibility: hidden` before first paint — zero scroll jump when JS hydrates |
| **2. `document_end`** | [main.js](src/content/main.js) boots before subresources finish and uses a frame-0 `requestAnimationFrame` pass during cold load (`150ms` debounce for steady streaming) | Eliminates startup lag while deferring heavy dynamic attribution scans to `requestIdleCallback` |
| **3. Render Isolation** | [ui-overlay.css](src/content/ui-overlay.css), [early-perf.css](src/content/early-perf.css), [collapse-manager.js](src/content/collapse-manager.js) | Applies `contain: layout style` to wrapped turns, suppresses heavy shadows/filters during initial mount, and tags wrapped `<img>` nodes `lazy`/`async` |

## Installation

Works on **Google Chrome**, **Microsoft Edge**, **Opera GX**, and other Chromium Manifest V3 browsers.

### Option A — Download Release (Recommended)

1. Download the latest `gemini-web-optimizer-v*.zip` from [**Releases**](https://github.com/Raincl-oud/gemini-optimizer-ext/releases).
2. Extract the `.zip` into a permanent folder on your computer.
3. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Opera GX: `opera://extensions`
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select the extracted folder (containing `manifest.json`).
6. Open or reload [gemini.google.com](https://gemini.google.com/).

### Option B — Clone from Source

```bash
git clone https://github.com/Raincl-oud/gemini-optimizer-ext.git
```

Then follow steps **3–6** above, selecting the cloned `gemini-optimizer-ext` folder.

<details>
<summary><strong>How to update after pulling changes</strong></summary>

1. Run `git pull` inside your extension folder (or replace files with a newer release zip).
2. Open `chrome://extensions` (or `edge://extensions` / `opera://extensions`) and click the **Reload** icon on **Gemini Web Optimizer**.
3. Refresh any open Gemini tab.

</details>

## Privacy & Permissions

**100% local execution** — zero telemetry, zero analytics, and zero external network requests.

| Permission / Storage | Why It's Needed |
| :--- | :--- |
| `host_permissions` (`https://gemini.google.com/*`) | Restricts content scripts strictly to Gemini Web pages. |
| `storage` (`chrome.storage.local`) | Persists your popup settings locally across sessions. |
| `localStorage['goptEarly']` *(on `gemini.google.com`)* | Minimal 3-field mirror (`autoCollapse`, `openPastChats`, `hideSources`) enabling synchronous `document_start` pre-wrapping. |
| `tabs` | Queries the active Gemini tab so the popup can show live turn counts and run quick actions (`Open All`, `Wrap Old`, `Top`, `Bottom`). |

## Development & Testing

No bundler, build step, or `npm install` is required — edit files and reload in the browser. Requires **Node.js 18+** to run the automated syntax, logic, and CSS guardrail test suite (`45` checks):

```bash
node tests/unit-checks.mjs
```

<details>
<summary><strong>Project Structure</strong></summary>

```text
.
├── manifest.json                 # Manifest V3 configuration
├── icons/                        # Extension icons (16, 48, 128 px)
├── src/
│   ├── content/
│   │   ├── early-boot.js         # document_start pre-wrap & cold-load guard
│   │   ├── early-perf.css        # Performance hints, full-width & cold-load suppression
│   │   ├── ui-overlay.css        # Summary bars, Wrap pill, strip rail, tooltip & typography
│   │   ├── collapse-manager.js   # Wrap state machine, sticky pill & lazy media deferral
│   │   ├── strip-navigator.js    # Left strip navigator & tooltip portal
│   │   └── main.js               # Content orchestrator & popup message bridge
│   ├── popup/                    # Adaptive popup UI (HTML, CSS, JS)
│   └── shared/
│       ├── settings.js           # Settings schema, validation & serialized storage queue
│       └── selectors.js          # Gemini LR26 DOM selectors & attribution matchers
├── tests/
│   └── unit-checks.mjs           # Zero-dependency Node syntax, unit & CSS guardrail suite
├── .github/workflows/ci.yml      # GitHub Actions CI workflow
├── docs/specs/                   # Architecture & design specifications
└── VERSION.md                    # Monotonic release history
```

</details>

## Changelog & License

- Full release history: [VERSION.md](VERSION.md)
- Licensed under the [MIT License](LICENSE)
