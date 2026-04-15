const MESSAGES = {
  GET_HISTORY: 'GET_HISTORY',
  CLEAR_HISTORY: 'CLEAR_HISTORY',
  DELETE_HISTORY_ITEM: 'DELETE_HISTORY_ITEM',
  GET_PERMITTED_URLS: 'GET_PERMITTED_URLS',
  SET_PERMITTED_URLS: 'SET_PERMITTED_URLS',
  GET_SETTINGS: 'GET_SETTINGS',
  SET_SETTINGS: 'SET_SETTINGS'
};

const DEFAULT_QUEUE_SIZE = 10;
const MIN_QUEUE_SIZE = 1;
const MAX_QUEUE_SIZE = 100;

let currentHistory = [];
let activeTabId = null;
let activeTabPermitted = true;
const expandedItemIds = new Set();
const itemViewModes = new Map();

function normalizeQueueSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_QUEUE_SIZE;
  }
  return Math.max(MIN_QUEUE_SIZE, Math.min(MAX_QUEUE_SIZE, parsed));
}

async function loadVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    const version = manifest.version;
    const badge = document.getElementById('versionBadge');
    if (badge && version) {
      badge.textContent = `v${version}`;
    }
  } catch (error) {
    console.warn('Could not load version:', error);
  }
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function buildCsv(item) {
  if (!item.columns || item.columns.length === 0) {
    return '';
  }

  const escapeCsvCell = (value) => {
    const str = String(value ?? '');
    // Quote if contains comma, quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const header = item.columns.map(escapeCsvCell).join(',');
  const rows = item.rows.map(row =>
    item.columns.map((_, index) => escapeCsvCell(row[index] ?? '')).join(',')
  );
  return [header, ...rows].join('\r\n');
}

function normalizeCharts(charts = []) {
  return charts
    .map((chart, index) => {
      if (typeof chart === 'string') {
        return {
          title: `Chart ${index + 1}`,
          type: 'image',
          dataUrl: chart
        };
      }

      if (!chart?.dataUrl) {
        return null;
      }

      return {
        title: chart.title || `Chart ${index + 1}`,
        type: chart.type || 'image',
        dataUrl: chart.dataUrl
      };
    })
    .filter(Boolean);
}

function exportCsv(item) {
  const csv = buildCsv(item);
  if (!csv) {
    return;
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const filename = `${item.queryName.replace(/[^a-z0-9_\-]/gi, '_')}_${new Date(item.timestamp).toISOString().slice(0, 10)}.csv`;
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyCsvToClipboard(item, btn) {
  const csv = buildCsv(item);
  if (!csv) {
    return;
  }
  try {
    await navigator.clipboard.writeText(csv);
    const original = btn.innerHTML;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 7l3.5 3.5L12 3" stroke="#34d399" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    setTimeout(() => { btn.innerHTML = original; }, 1800);
  } catch {
    btn.title = 'Clipboard access denied';
  }
}

function snapItem() {
  // Send a CAPTURE_NOW message to the active Redash tab so the content script
  // captures the current live results.
  if (typeof activeTabId !== 'number') return;
  chrome.tabs.sendMessage(activeTabId, { type: 'CAPTURE_NOW' }, () => {
    // Reload panel data after a short delay to pick up the new snapshot
    setTimeout(() => loadData(), 800);
  });
}

function getDefaultViewMode(item) {
  const hasTable = Array.isArray(item.columns) && item.columns.length > 0;
  const hasCharts = Array.isArray(item.charts) && item.charts.length > 0;

  if (hasTable) {
    return 'table';
  }
  if (hasCharts) {
    return 'charts';
  }
  return 'table';
}

function applyResultTabMode(resultItem, mode) {
  resultItem.querySelectorAll('.result-tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });

  resultItem.querySelectorAll('.result-tab-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.dataset.pane === mode);
  });
}

function renderResults() {
  const container = document.getElementById('resultsList');
  const emptyState = document.getElementById('emptyState');
  const notPermittedState = document.getElementById('notPermittedState');
  const itemCount = document.getElementById('itemCount');
  const headerActions = document.getElementById('headerActions');

  const snapBtn = document.getElementById('snapBtn');

  if (!activeTabPermitted) {
    emptyState.style.display = 'none';
    container.style.display = 'none';
    notPermittedState.style.display = 'flex';
    itemCount.textContent = '';
    headerActions.style.visibility = 'hidden';
    if (snapBtn) snapBtn.style.visibility = 'hidden';
    return;
  }

  notPermittedState.style.display = 'none';
  headerActions.style.visibility = 'visible';
  if (snapBtn) snapBtn.style.visibility = 'visible';

  itemCount.textContent = currentHistory.length > 0
    ? `${currentHistory.length} result${currentHistory.length !== 1 ? 's' : ''}`
    : '';

  if (currentHistory.length === 0) {
    emptyState.style.display = 'flex';
    container.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  container.style.display = 'flex';

  container.innerHTML = currentHistory.map(item => {
    const charts = normalizeCharts(item.charts);
    const hasTable = item.columns.length > 0;
    const hasCharts = charts.length > 0;
    const savedMode = itemViewModes.get(item.id);
    const activeMode = (
      savedMode === 'table' && hasTable
    ) || (
      savedMode === 'charts' && hasCharts
    ) ? savedMode : getDefaultViewMode(item);
    itemViewModes.set(item.id, activeMode);

    const headerCells = item.columns.map(col => `<th title="${escapeHtml(col)}">${escapeHtml(col)}</th>`).join('');
    const bodyRows = item.rows.map(row => {
      const cells = item.columns.map((col, index) => {
        const value = row[index] ?? '';
        return `<td title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <div class="result-item${expandedItemIds.has(item.id) ? ' expanded' : ''}" data-id="${item.id}">
        <div class="result-item-header">
          <div class="result-item-info">
            <div class="result-item-title" title="${escapeHtml(item.queryName)}">${escapeHtml(item.queryName)}</div>
            <div class="result-item-meta">
              <span>${formatTimeAgo(item.timestamp)}</span>
              <span>${item.rows.length} rows</span>
              <span>${item.columns.length} columns</span>
            </div>
          </div>
          <div class="result-item-actions">
            <button class="expand-btn" title="Expand/Collapse">
              <svg class="chevron-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="open-link" title="Open in new tab" data-url="${escapeHtml(item.resultUrl)}">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11 3v8H3V3h8m1-1H2v10h10V2z" fill="currentColor"/>
                <path d="M6 1h7v7M13 1L6 8" stroke="currentColor" stroke-width="1.5"/>
              </svg>
            </button>
            <button class="delete" title="Delete">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="result-item-content">
          <div class="result-content-tabs">
            ${hasTable ? `<button class="result-tab-btn ${activeMode === 'table' ? 'active' : ''}" data-mode="table">Table</button>` : ''}
            ${hasCharts ? `<button class="result-tab-btn ${activeMode === 'charts' ? 'active' : ''}" data-mode="charts">Charts</button>` : ''}
          </div>

          <div class="result-tab-pane ${activeMode === 'table' ? 'active' : ''}" data-pane="table">
            ${hasTable ? `
            <div class="result-item-toolbar">
              <button class="toolbar-btn export-csv-btn" title="Download as CSV file">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                Export CSV
              </button>
              <button class="toolbar-btn copy-csv-btn" title="Copy CSV to clipboard">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="5" y="5" width="8" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M11 5V4a1 1 0 00-1-1H4a1 1 0 00-1 1v8a1 1 0 001 1h1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                Copy CSV
              </button>
            </div>
            <div class="result-table-wrapper">
              <table class="result-table">
                <thead>
                  <tr>${headerCells}</tr>
                </thead>
                <tbody>
                  ${bodyRows}
                </tbody>
              </table>
            </div>
            ` : '<div class="result-empty-view">No table data in this snapshot.</div>'}
          </div>

          <div class="result-tab-pane ${activeMode === 'charts' ? 'active' : ''}" data-pane="charts">
            ${hasCharts ? `
            <div class="result-charts">
              ${charts.map((chart) => `
                <div class="result-chart-card">
                  <div class="result-chart-title">${escapeHtml(chart.title)}</div>
                  <img class="result-chart-img" src="${chart.dataUrl}" alt="${escapeHtml(chart.title)}" title="${escapeHtml(chart.title)}"/>
                </div>
              `).join('')}
            </div>
            ` : '<div class="result-empty-view">No chart images in this snapshot.</div>'}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.result-tab-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const resultItem = button.closest('.result-item');
      const mode = button.dataset.mode;
      itemViewModes.set(resultItem.dataset.id, mode);
      applyResultTabMode(resultItem, mode);
    });
  });

  container.querySelectorAll('.result-item-header').forEach(header => {
    header.addEventListener('click', (event) => {
      if (event.target.closest('.result-item-actions')) return;
      const item = header.closest('.result-item');
      item.classList.toggle('expanded');
      syncExpandedState(item);
    });
  });

  container.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const item = btn.closest('.result-item');
      item.classList.toggle('expanded');
      syncExpandedState(item);
    });
  });

  container.querySelectorAll('.open-link').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      chrome.tabs.create({ url: btn.dataset.url, active: true });
    });
  });

  container.querySelectorAll('.result-item-actions .delete').forEach(btn => {
    btn.addEventListener('click', async (event) => {
      event.stopPropagation();
      const item = btn.closest('.result-item');
      await deleteItem(item.dataset.id);
    });
  });

  container.querySelectorAll('.export-csv-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const el = btn.closest('.result-item');
      exportCsv(currentHistory.find(i => i.id === el.dataset.id));
    });
  });

  container.querySelectorAll('.copy-csv-btn').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const el = btn.closest('.result-item');
      copyCsvToClipboard(currentHistory.find(i => i.id === el.dataset.id), btn);
    });
  });
}

function syncExpandedState(item) {
  const id = item?.dataset.id;
  if (!id) {
    return;
  }

  if (item.classList.contains('expanded')) {
    expandedItemIds.add(id);
  } else {
    expandedItemIds.delete(id);
  }
}

function pruneExpandedState() {
  const currentIds = new Set(currentHistory.map(item => item.id));
  Array.from(expandedItemIds).forEach(id => {
    if (!currentIds.has(id)) {
      expandedItemIds.delete(id);
    }
  });

  Array.from(itemViewModes.keys()).forEach((id) => {
    if (!currentIds.has(id)) {
      itemViewModes.delete(id);
    }
  });
}

async function deleteItem(id) {
  if (typeof activeTabId !== 'number') {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: MESSAGES.DELETE_HISTORY_ITEM,
    tabId: activeTabId,
    id
  });

  currentHistory = response.history || [];
  renderResults();
  updateLastUpdated();
}

async function clearAll() {
  if (typeof activeTabId !== 'number' || currentHistory.length === 0) {
    return;
  }

  await chrome.runtime.sendMessage({
    type: MESSAGES.CLEAR_HISTORY,
    tabId: activeTabId
  });

  currentHistory = [];
  renderResults();
  updateLastUpdated();
}

function updateLastUpdated() {
  document.getElementById('lastUpdated').textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

async function loadData(knownTabId, knownPermitted) {
  let tab;
  if (typeof knownTabId === 'number') {
    tab = await chrome.tabs.get(knownTabId).catch(() => null);
  } else {
    ([tab] = await chrome.tabs.query({ active: true, currentWindow: true }));
  }

  activeTabId = tab?.id ?? null;

  if (typeof activeTabId !== 'number') {
    activeTabPermitted = false;
    currentHistory = [];
    renderResults();
    updateLastUpdated();
    return;
  }

  // Use the permitted flag passed from background if available, otherwise ask
  if (typeof knownPermitted === 'boolean') {
    activeTabPermitted = knownPermitted;
  } else {
    const { permitted } = await chrome.runtime.sendMessage({
      type: 'CHECK_URL',
      url: tab?.url || ''
    });
    activeTabPermitted = permitted;
  }

  if (!activeTabPermitted) {
    currentHistory = [];
    renderResults();
    updateLastUpdated();
    return;
  }

  const { history = [] } = await chrome.runtime.sendMessage({
    type: MESSAGES.GET_HISTORY,
    tabId: activeTabId
  });

  const newHistoryJson = JSON.stringify(history);
  const currentHistoryJson = JSON.stringify(currentHistory);

  if (newHistoryJson === currentHistoryJson) {
    updateLastUpdated();
    return;
  }

  currentHistory = history;
  pruneExpandedState();
  renderResults();
  updateLastUpdated();
}

function showSettings() {
  document.getElementById('settingsOverlay').classList.remove('hidden');
  loadSettingsData();
}

function hideSettings() {
  document.getElementById('settingsOverlay').classList.add('hidden');
}

async function loadSettingsData() {
  const [{ permittedUrls = [] }, { settings = {} }] = await Promise.all([
    chrome.runtime.sendMessage({ type: MESSAGES.GET_PERMITTED_URLS }),
    chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS })
  ]);

  document.getElementById('permittedUrls').value = permittedUrls.join('\n');
  document.getElementById('queueSize').value = normalizeQueueSize(settings.queueSize ?? DEFAULT_QUEUE_SIZE);
}

async function saveSettingsData() {
  const urls = document.getElementById('permittedUrls').value
    .split('\n')
    .map(url => url.trim())
    .filter(url => url.length > 0);

  const queueSize = normalizeQueueSize(document.getElementById('queueSize').value);
  document.getElementById('queueSize').value = queueSize;

  await Promise.all([
    chrome.runtime.sendMessage({ type: MESSAGES.SET_PERMITTED_URLS, urls }),
    chrome.runtime.sendMessage({ type: MESSAGES.SET_SETTINGS, settings: { queueSize } })
  ]);

  hideSettings();
  await loadData();
}

function applyLocalization() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const message = chrome.i18n.getMessage(element.dataset.i18n);
    if (!message) {
      return;
    }
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      element.placeholder = message;
    } else {
      element.textContent = message;
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TAB_ACTIVATED') {
    loadData(message.tabId, message.permitted);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  applyLocalization();
  await loadVersion();
  await loadData();

  document.getElementById('refreshBtn').addEventListener('click', () => loadData());
  document.getElementById('clearAllBtn').addEventListener('click', clearAll);
  document.getElementById('snapBtn').addEventListener('click', () => snapItem());
  document.getElementById('openSettingsBtn').addEventListener('click', showSettings);
  document.getElementById('closeSettingsBtn').addEventListener('click', hideSettings);
  document.getElementById('cancelSettingsBtn').addEventListener('click', hideSettings);
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsData);

  document.getElementById('settingsOverlay').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      hideSettings();
    }
  });

  setInterval(loadData, 10000);
});
