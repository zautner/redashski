# Redashski

Redashski is a Chrome extension that snapshots Redash query outputs locally.
It keeps a per-tab queue of recent snapshots and lets you compare table data and chart visuals in the side panel.

## What It Does

- Snap current Redash query state on demand.
- Store snapshots locally only (`chrome.storage.local`).
- Keep snapshots per browser tab (FIFO queue size configurable in Settings).
- Capture:
  - query metadata (name, URL, timestamp)
  - table data (columns + rows)
  - chart visuals (SVG/canvas captures from visualization tabs)
- Review snapshots in Side Panel with Table/Charts tabs.
- Export table view as CSV or copy CSV to clipboard.

## Core UX

- **Popup**: quick actions (Snap, toggle Side Panel, open Settings).
- **Side Panel**: main workspace for browsing history and comparing snapshots.
- **Snap behavior**:
  - from Table tab: captures table + available charts
  - from Chart tab: captures chart(s) and tries to fetch table data by switching to a table-like results tab, then restores original tab

## Installation (Unpacked)

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository folder

## Required Setup

Add your Redash URL prefixes in Settings (popup or side panel), for example:

```text
https://redash.example.com/
https://analytics.company.internal/
```

Only matching URLs are active for snapping.

## Permissions

- `storage` - local snapshot history and settings
- `tabs` / `activeTab` - tab-scoped history, active-tab operations
- `sidePanel` - side panel UI
- `scripting` - content integration
- host permissions (`<all_urls>`) with runtime URL allow-list filtering

## Architecture (Brief)

- `content/content-script.js` - detect/capture table + visual data on Redash pages
- `background/service-worker.js` - message router, storage queue, side panel state
- `ui/popup/*` - compact controls and settings
- `ui/sidepanel/*` - snapshot browser, Table/Charts tabs, CSV tools
- `shared/storage-keys.js` - shared constants and message names

## Notes

- Data never leaves the browser unless you export/copy manually.
- Chart capture quality depends on Redash visualization DOM and render timing.
- Very large snapshots may approach Chrome local storage limits.
