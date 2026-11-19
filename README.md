# Gemini Web Optimizer

A lightweight, zero-dependency Manifest V3 browser extension for [Gemini Web](https://gemini.google.com/) that keeps long conversations fast, readable, and easy to navigate — without detaching Angular DOM nodes or breaking native controls.

## Features

- **Wrap Long Chats:** Automatically wraps older conversation turns into compact summary bars while keeping the latest turn plus your configured number of **Open Past Chats** (`0–999`, default `4`) expanded. Manually opened past chats show a dynamic sticky **Wrap** pill.
- **Heavy Conversation Cold-Load Optimization:** Synchronous `document_start` CSS pre-wrapping, `document_end` script boot with frame-0 `rAF` cold-load pass, `requestIdleCallback` attribution deferral, CSS containment, and `loading="lazy"` / `decoding="async"` media deferral on wrapped turns.
- **Left Strip Navigator:** 1:1 scrollable strip rail along the left edge of open chats with smooth hover magnification, prompt preview tooltips (`Wrapped` / `Open`), and click-to-jump auto-expansion.
- **Adjustable Full Width (`60%–100%`):** Expands chat content and composer to your preferred width with smooth toggle animation, Canvas split-pane protection, and automatic exemption on the Gemini Home / New Chat screen.
- **Typography Controls:** Independent font family (`Default`, `Sans`, `Serif`, `Mono`), font size, line height, paragraph spacing, and letter spacing — while keeping code blocks and tables clean.
- **Hide Sources & Citations:** Declutters inline source chips, citation carousels, and attribution strips while preserving Drive/Gmail cards, regular Markdown links, and *Show thinking*.
- **Quick Scroll-to-Bottom:** Clean circular button aligned above the composer, hiding duplicate native buttons.

## Installation (Chrome / Edge / Opera GX)

1. Download the latest release `.zip` from **Releases** (or clone this repository).
2. Extract the archive if downloaded as a `.zip`.
3. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Opera GX: `opera://extensions`
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the folder containing `manifest.json`.
6. Open or reload [https://gemini.google.com/](https://gemini.google.com/).

## Privacy & Permissions

- **100% local:** No telemetry, analytics, or external network requests.
- **`host_permissions` (`https://gemini.google.com/*`):** Runs exclusively on Gemini Web.
- **`storage`:** Saves your settings locally in `chrome.storage.local` (with a minimal `localStorage['goptEarly']` mirror on `gemini.google.com` for synchronous `document_start` pre-wrapping).
- **`tabs`:** Queries the active Gemini tab so the popup can show live turn stats and trigger quick actions (`Open All`, `Wrap Old`, `Top`, `Bottom`).

## Project Structure

```text
.
├── manifest.json                 # Manifest V3 configuration
├── icons/                        # Extension icons (16, 48, 128 px)
├── src/
│   ├── content/
│   │   ├── early-boot.js         # document_start pre-wrap & cold-load guard
│   │   ├── early-perf.css        # Performance hints, full-width & cold-load rules
│   │   ├── ui-overlay.css        # Bars, Wrap pill, strip rail, tooltip & typography
│   │   ├── collapse-manager.js   # Wrap state machine, sticky pill & media deferral
│   │   ├── strip-navigator.js    # Left strip navigator & tooltip portal
│   │   └── main.js               # Content orchestrator & message handler
│   ├── popup/                    # Extension popup UI (HTML/CSS/JS)
│   └── shared/
│       ├── settings.js           # Settings schema, validation & serialized storage
│       └── selectors.js          # Gemini DOM selectors & attribution matchers
├── tests/
│   └── unit-checks.mjs           # Zero-dependency Node syntax, logic & CSS guardrail suite
├── docs/specs/                   # Design documents
└── VERSION.md                    # Release history
```

## Development & Verification

No build step or `npm install` is required. Requires Node.js (v18+ recommended) to run the automated test suite:

```bash
node tests/unit-checks.mjs
```

After making changes locally, click the reload icon on your extension card in `chrome://extensions` and refresh Gemini Web.

## License

[MIT](LICENSE)
