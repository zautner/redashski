<div align="center">

# Redashski

**Local result buffer for Redash, built as a Chrome Extension.**

[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?logo=googlechrome&logoColor=white)](#requirements)
[![Version](https://img.shields.io/badge/version-1.0.3-6B72E6)](#version-history)
[![License](https://img.shields.io/badge/license-MIT-333333)](#license)
[![Storage](https://img.shields.io/badge/storage-local_only-06960e)](#data-privacy)

Automatically captures Redash query results as you work and stores them in a local FIFO buffer.
No re-runs. No cloud sync. Just the last 10 results, always one click away.

</div>

---

## Why Redashski?

You run a query in Redash. You see the number you need. You navigate away.
Five minutes later: *"What was that number?"*

Redashski solves this by quietly buffering every result you see.
It sits in the background, watches for query results, and keeps the last 10 in local storage.

- **No re-execution** of expensive queries
- **No copy-pasting** into spreadsheets
- **No browser history digging** to find the right tab
- **No cloud** — your data never leaves your machine

---

## Quick Start

```
1.  chrome://extensions/  →  Developer mode ON  →  Load unpacked  →  select this folder
2.  Click Redashski icon  →  Settings (gear)  →  add your Redash URL prefix
3.  Navigate to any Redash query  →  results auto-capture
```

That's it. The toolbar icon turns active when you're on a permitted Redash site.

---

## Features

### Result Capture

| Method | Trigger | Feedback |
|--------|---------|----------|
| **Automatic** | Navigate to a query page | Silent (background) |
| **Floating button** | Click "Capture Now" on Redash page | Toast notification |
| **Popup button** | Click capture icon in toolbar popup | Status bar message |

The content script detects SPA navigation using the Navigation API
(`navigation.addEventListener`) with a URL-polling fallback for older browsers.
A `MutationObserver` waits for the query spinner to disappear before capturing.

### FIFO Buffer

```
  newest ──► [ result ] [ result ] [ result ] ... [ result ] ◄── oldest
               #1         #2         #3             #10

  On capture:  unshift(new)  →  slice(0, 10)  →  oldest drops off
```

Each entry stores:

| Field | Example |
|-------|---------|
| `id` | `"m5x7k2...a9f"` |
| `timestamp` | `1713206400000` |
| `queryId` | `42` |
| `queryName` | `"Daily Active Users"` |
| `resultUrl` | `https://redash.example.com/queries/42` |
| `columns` | `["date", "users", "sessions"]` |
| `rows` | All visible rows at capture time |

### Dual Interface

**Popup** — lightweight, for quick checks.
Shows the 5 most recent rows per result as a preview table.
Open a result in a new tab. Delete items. Trigger manual capture.

**Side Panel** — persistent, for comparison workflows.
Expand any result to see the full table with sticky headers.
Auto-refreshes every 10 seconds. Stays open as you navigate.

### Dynamic Icon

| State | Icon | Meaning |
|-------|------|---------|
| Inactive | Default | Not on a permitted Redash URL |
| Active | Green overlay | Permitted site detected, capture enabled |

The icon updates on every tab switch and page load.

### URL Whitelist

Configure one or more URL prefixes. Only pages whose URL starts with
a listed prefix will activate the extension.

```
https://redash.example.com/
http://internal-redash.corp.net/
https://analytics.team.io/
```

---

## Architecture

```
redashski/
│
├── manifest.json                   MV3 manifest
├── _locales/en/messages.json       i18n strings
│
├── background/
│   ├── service-worker.js           Storage engine, FIFO queue, message router,
│   │                               icon switching (tabs.onActivated/onUpdated)
│   └── url-validator.js            Prefix matching against permitted URLs
│
├── content/
│   └── content-script.js           SPA navigation detection, MutationObserver,
│                                   DOM table extraction, floating capture button,
│                                   toast feedback
│
├── shared/
│   └── storage-keys.js             Constants: storage keys, message types, selectors
│
├── ui/
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css               Redash-derived color palette
│   │   └── popup.js                History rendering, settings, capture trigger
│   │
│   └── sidepanel/
│       ├── sidepanel.html
│       ├── sidepanel.css
│       └── sidepanel.js            Expandable results, auto-refresh, settings overlay
│
└── icons/
    ├── icon-{16,48,128}.png        Default (inactive) state
    └── icon-{16,48,128}-active.png Active state (on permitted URL)
```

### Data Flow

```
  ┌─────────────────────────────────────────────────────────────┐
  │  Redash Page                                                │
  │                                                             │
  │  Navigation API / URL polling                               │
  │       │                                                     │
  │       ▼                                                     │
  │  MutationObserver (waits for table render)                  │
  │       │                                                     │
  │       ▼                                                     │
  │  extractTableData()  →  extractQueryInfo()                  │
  │       │                                                     │
  └───────┼─────────────────────────────────────────────────────┘
          │  chrome.runtime.sendMessage({ type: ADD_RESULT })
          ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Service Worker                                             │
  │                                                             │
  │  isUrlPermitted(url)  →  addResult(payload)                 │
  │       │                       │                             │
  │       │                       ▼                             │
  │       │                 history.unshift(entry)              │
  │       │                 history.slice(0, 10)                │
  │       │                       │                             │
  │       ▼                       ▼                             │
  │  chrome.storage.local.set({ history })                      │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘
          │  chrome.runtime.sendMessage({ type: GET_HISTORY })
          ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Popup / Side Panel                                         │
  │                                                             │
  │  Renders result cards from storage                          │
  │  Open in new tab  │  Delete  │  Expand  │  Clear all        │
  └─────────────────────────────────────────────────────────────┘
```

---

## Permissions

| Permission | Type | Why |
|------------|------|-----|
| `storage` | Permission | FIFO buffer + settings in `chrome.storage.local` |
| `activeTab` | Permission | Access current tab for popup-triggered capture |
| `scripting` | Permission | Content script execution |
| `sidePanel` | Permission | Chrome Side Panel API |
| `tabs` | Permission | Icon state changes on `tabs.onActivated` / `tabs.onUpdated` |
| `<all_urls>` | Host | Content script matches all URLs (filtered at runtime by whitelist) |

### Data Privacy

All data stays on your machine.

- Storage: `chrome.storage.local` only (never `sync`)
- Network: zero outbound requests
- The extension has no background fetch, no analytics, no telemetry

---

## Requirements

| Requirement | Minimum |
|-------------|---------|
| Browser | Chrome 114+ / Edge 114+ |
| Manifest | V3 |
| Redash | Any version with `data-test` attributes or `.table-responsive` tables |

---

## Limitations

| Area | Constraint |
|------|-----------|
| **Storage quota** | `chrome.storage.local` caps at 10 MB. Large result tables may approach this. |
| **Row scope** | Captures only rows currently rendered in the DOM. Paginated or lazy-loaded rows beyond the viewport are not captured. |
| **Selector coupling** | DOM selectors target `[data-test="QueryPageResults"]`, `.table-responsive`, and `[data-test="QueryTitle"]`. Redash UI changes may require selector updates. |
| **SPA fallback** | Browsers without the Navigation API fall back to 1-second URL polling. |
| **Service worker lifecycle** | Chrome may suspend the service worker. UI components re-fetch data on activation. |

---

## Troubleshooting

**Results not capturing?**
1. Open Settings and confirm your Redash URL prefix is listed
2. Open DevTools (`F12`) and check Console for errors
3. Try the floating "Capture Now" button to test manually

**Icon not changing?**
1. Reload the extension at `chrome://extensions/`
2. Verify the page URL starts with one of your permitted prefixes exactly

**Side panel won't open?**
1. Requires Chrome 114+
2. Try: right-click extension icon in toolbar, select "Open side panel"

---

## TODO

### High Priority

- [ ] Validate against a live Redash instance (selectors, SPA timing)
- [ ] Adaptive DOM selectors for Redash version differences
- [ ] Storage quota guard — warn or truncate when approaching 10 MB

### Medium Priority

- [ ] Keyboard shortcut for manual capture (`Ctrl+Shift+S`)
- [ ] Export captured results to JSON / CSV
- [ ] Search and filter within buffered results
- [ ] Duplicate detection — skip re-capture of identical query+result

### Low Priority

- [ ] Configurable buffer size (currently hardcoded to 10)
- [ ] Dark mode
- [ ] Dashboard and visualization capture (beyond query tables)
- [ ] Service worker keep-alive optimization

---

## Version History

| Version | Changes |
|---------|---------|
| **1.0.3** | Added missing `sidePanel` and `tabs` permissions to manifest |
| **1.0.2** | Fixed ES module imports in content script; `sidePanel.open()` null safety |
| **1.0.1** | Added `CHECK_URL` message handler in service worker |
| **1.0.0** | Initial release — FIFO buffer, popup, side panel, auto-capture |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/export-csv`)
3. Make changes and test locally via `chrome://extensions/` → Load unpacked
4. Submit a pull request

---

## License

MIT
