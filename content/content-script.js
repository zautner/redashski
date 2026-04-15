const MESSAGES = {
  ADD_RESULT: 'ADD_RESULT',
  GET_HISTORY: 'GET_HISTORY',
  CLEAR_HISTORY: 'CLEAR_HISTORY',
  GET_PERMITTED_URLS: 'GET_PERMITTED_URLS',
  SET_PERMITTED_URLS: 'SET_PERMITTED_URLS',
  CHECK_URL: 'CHECK_URL',
  OPEN_SIDE_PANEL: 'OPEN_SIDE_PANEL'
};

const REDASH_SELECTORS = {
  RESULTS_CONTAINER: '[data-test="QueryPageResults"]',
  LOADER: '[data-test="QueryPageLoader"]',
  TABLE: '.table-responsive table',
  QUERY_TITLE: '[data-test="QueryTitle"]',
  QUERY_LINK: 'a[href*="/queries/"]'
};

let isActive = false;
let mutationObserver = null;
let lastCapturedUrl = null;
let lastCaptureTime = 0;
let executeButtonObserver = null;

async function checkPermissions() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: MESSAGES.CHECK_URL, url: window.location.href },
      (response) => {
        isActive = response?.permitted || false;
        resolve(isActive);
      }
    );
  });
}

function setIconState(active) {
  chrome.runtime.sendMessage({
    type: 'SET_ACTIVE_STATE',
    isActive: active
  });
}

function extractTableData() {
  const container = document.querySelector(REDASH_SELECTORS.RESULTS_CONTAINER);
  if (!container) {
    const altContainer = document.querySelector('.query-results, .table-responsive, [class*="results"]');
    if (!altContainer) return null;
    return extractFromTable(altContainer.querySelector('table') || altContainer);
  }

  const table = container.querySelector(REDASH_SELECTORS.TABLE);
  if (!table) {
    const altTable = container.querySelector('table');
    if (altTable) {
      return extractFromTable(altTable);
    }
    return null;
  }

  return extractFromTable(table);
}

function extractFromTable(table) {
  if (!table) return null;

  const headerRow = table.querySelector('thead tr');
  const headers = headerRow ? Array.from(headerRow.querySelectorAll('th, td')) : [];
  const columns = headers.map(th => th.textContent.trim() || `Column_${headers.indexOf(th)}`);

  const tbody = table.querySelector('tbody');
  if (!tbody) return { columns, rows: [] };

  const dataRows = tbody.querySelectorAll('tr');
  const rows = [];

  dataRows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length > 0) {
      const rowData = {};
      cells.forEach((cell, index) => {
        rowData[index] = cell.textContent.trim();
      });
      rows.push(rowData);
    }
  });

  if (columns.length === 0 || rows.length === 0) {
    return null;
  }

  return { columns, rows };
}

function extractQueryInfo() {
  // Try data-test attribute first (older Redash builds)
  let queryName = null;
  const titleElement = document.querySelector(REDASH_SELECTORS.QUERY_TITLE);
  if (titleElement) {
    queryName = titleElement.textContent.trim() || null;
  }

  // Redash renders the query name as an editable text field or heading.
  // Try common selectors used across Redash versions.
  if (!queryName) {
    const candidates = [
      // Confirmed Redash DOM path
      '#application-root > div.application-layout-content > div > div.container.w-100 > div > div.title-with-tags > div.page-title > div > h3 > span > span',
      // Shorter fallbacks for the same structure
      '.title-with-tags .page-title h3 span span',
      '.title-with-tags .page-title h3',
      '.page-title h3',
      '.query-name',
      '[data-test="QueryName"]',
      '.query-title',
      'h2.query-name',
      '.editor-wrapper .title',
      // Redash v8+: editable span inside the header
      '.query-page-header .title',
      '.query-page-header [contenteditable]',
      '[contenteditable="true"]',
      // Input field used in some versions
      'input.query-name',
      'input[placeholder*="query" i]',
      'input[placeholder*="name" i]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.value || el.textContent || '').trim();
        if (text && text.toLowerCase() !== 'new query') {
          queryName = text;
          break;
        }
      }
    }
  }

  // Fall back to the document <title>: Redash sets it to "<Query Name> | Redash"
  if (!queryName) {
    const pageTitle = document.title || '';
    const titleMatch = pageTitle.match(/^(.+?)\s*[|\-–]\s*(Redash|redash)/i);
    if (titleMatch) {
      const candidate = titleMatch[1].trim();
      if (candidate && candidate.toLowerCase() !== 'new query') {
        queryName = candidate;
      }
    }
  }

  // Extract query ID from URL
  let queryId = null;
  const urlMatch = window.location.pathname.match(/\/queries\/(\d+)/);
  if (urlMatch) {
    queryId = parseInt(urlMatch[1], 10);
  }

  if (!queryId) {
    const link = document.querySelector(REDASH_SELECTORS.QUERY_LINK);
    if (link) {
      const href = link.getAttribute('href');
      const match = href?.match(/\/queries\/(\d+)/);
      if (match) {
        queryId = parseInt(match[1], 10);
      }
    }
  }

  return {
    queryName: queryName || 'Untitled Query',
    queryId: queryId || 0,
    resultUrl: window.location.href.split('#')[0]
  };
}

function isElementVisible(element) {
  if (!element) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 20 && rect.height > 20;
}

function isChartLikeElement(element) {
  if (!isElementVisible(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 120) {
    return false;
  }

  if (element.tagName.toLowerCase() === 'canvas') {
    return true;
  }

  if (element.tagName.toLowerCase() !== 'svg') {
    return false;
  }

  const childShapeCount = element.querySelectorAll('path, rect, circle, line, polyline, polygon, g, text').length;
  if (childShapeCount < 8) {
    return false;
  }

  const ancestor = element.parentElement;
  const ancestorText = (ancestor?.textContent || '').trim();
  if (ancestorText.length > 0 && ancestorText.length < 20 && childShapeCount < 15) {
    return false;
  }

  return true;
}

function getChartRoot(element) {
  if (!element) {
    return null;
  }

  return element.closest('.svg-container, .js-plotly-plot, .plot-container, [data-testid*="chart" i], [class*="chart"]');
}

function getChartLikeElements(container) {
  const chartRoots = Array.from(
    container.querySelectorAll('.svg-container, .js-plotly-plot, .plot-container')
  ).filter(isElementVisible);

  if (chartRoots.length > 0) {
    return chartRoots
      .map(root => {
        const svgCandidates = Array.from(root.querySelectorAll('svg.main-svg')).filter(isChartLikeElement);
        const svg = svgCandidates
          .sort((a, b) => {
            const aArea = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
            const bArea = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
            return bArea - aArea;
          })[0];
        if (svg && isChartLikeElement(svg)) {
          return svg;
        }

        const canvas = root.querySelector('canvas');
        if (canvas && isChartLikeElement(canvas)) {
          return canvas;
        }

        return null;
      })
      .filter(Boolean);
  }

  return Array.from(container.querySelectorAll('svg, canvas')).filter((element) => {
    if (!isChartLikeElement(element)) {
      return false;
    }

    const root = getChartRoot(element);
    return !root || root.querySelector('svg.main-svg, canvas') === element;
  });
}

function getVisualizationContainers() {
  return [
    document.querySelector(REDASH_SELECTORS.RESULTS_CONTAINER),
    document.querySelector('.query-results'),
    document.querySelector('[class*="visualizations"]'),
    document.querySelector('[class*="visualization"]'),
    document.body
  ].filter(Boolean);
}

function getVisualizationTabs() {
  const selectors = [
    '[role="tab"]',
    '[id^="rc-tabs-"][role="tab"]',
    '[class*="tabs"] [aria-controls]',
    '[class*="visualization"] [role="tab"]'
  ];

  const seen = new Set();
  const tabs = [];

  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((tab) => {
      if (seen.has(tab)) {
        return;
      }
      const label = (tab.textContent || '').trim();
      if (!label) {
        return;
      }
      seen.add(tab);
      tabs.push(tab);
    });
  });

  return tabs;
}

function getTabLabel(tab) {
  return (
    (tab.textContent || '').trim() ||
    (tab.getAttribute('aria-label') || '').trim() ||
    (tab.getAttribute('title') || '').trim()
  );
}

function getActiveVisualizationTab(tabs) {
  return tabs.find(tab =>
    tab.getAttribute('aria-selected') === 'true' ||
    tab.classList.contains('ant-tabs-tab-active') ||
    tab.classList.contains('rc-tabs-tab-active')
  ) || tabs[0] || null;
}

function resolveTabPanel(tab) {
  const controlsId = tab.getAttribute('aria-controls');
  if (controlsId) {
    const panel = document.getElementById(controlsId);
    if (panel) {
      return panel;
    }
  }

  const tabId = tab.id;
  if (tabId) {
    const labelledPanel = document.querySelector(`[aria-labelledby="${tabId}"]`);
    if (labelledPanel) {
      return labelledPanel;
    }
  }

  const rcPanelId = tabId ? tabId.replace('-tab-', '-panel-') : null;
  if (rcPanelId) {
    const rcPanel = document.getElementById(rcPanelId);
    if (rcPanel) {
      return rcPanel;
    }
  }

  return tab.closest('[class*="tabs"]')?.parentElement?.querySelector('[role="tabpanel"]') || null;
}

function findNearestVisualizationPanel(element) {
  if (!element) {
    return null;
  }

  return element.closest('[role="tabpanel"], [id*="panel"], [class*="tab-pane"], [class*="visualization"]');
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForVisualizationRender(panel) {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const scope = panel || document;
    const hasRenderable = getChartLikeElements(scope).length > 0;
    if (hasRenderable) {
      await wait(120);
      return;
    }
    await wait(120);
  }
}

function serializeSvg(svg) {
  const clone = svg.cloneNode(true);
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  const markup = new XMLSerializer().serializeToString(clone);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function captureVisualElements(container, tabLabel, dedupeKeys) {
  const charts = [];
  const elements = getChartLikeElements(container);
  const visibleSvgs = elements.filter(element => element.tagName.toLowerCase() === 'svg');
  const visibleCanvases = elements.filter(element => element.tagName.toLowerCase() === 'canvas');
  const captures = [];

  visibleSvgs.forEach((svg) => {
    try {
      const dataUrl = serializeSvg(svg);
      captures.push({ type: 'svg', dataUrl, signature: `svg:${dataUrl.length}` });
    } catch {
      // Ignore malformed SVGs.
    }
  });

  visibleCanvases.forEach((canvas) => {
    if (canvas.width < 50 || canvas.height < 50) {
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl && dataUrl !== 'data:,') {
        captures.push({ type: 'canvas', dataUrl, signature: `canvas:${dataUrl.length}` });
      }
    } catch {
      // Ignore tainted canvases.
    }
  });

  captures.forEach((capture, index) => {
    const title = captures.length === 1 ? tabLabel : `${tabLabel} #${index + 1}`;
    const dedupeKey = `${tabLabel}:${capture.signature}`;
    if (dedupeKeys.has(dedupeKey)) {
      return;
    }
    dedupeKeys.add(dedupeKey);
    charts.push({
      title,
      type: capture.type,
      dataUrl: capture.dataUrl
    });
  });

  return charts;
}

function captureVisibleVisualizationsFallback() {
  const dedupeKeys = new Set();

  for (const container of getVisualizationContainers()) {
    const charts = captureVisualElements(container, 'Visualization', dedupeKeys);
    if (charts.length > 0) {
      return charts;
    }
  }

  return [];
}

function findRenderableInVisiblePanels() {
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"], [id*="panel"]'));
  for (const panel of panels) {
    if (!isElementVisible(panel)) {
      continue;
    }
    const renderable = getChartLikeElements(panel)[0];
    if (renderable) {
      return { panel, renderable };
    }
  }

  const fallbackRenderable = getChartLikeElements(document.body)[0];
  if (fallbackRenderable) {
    return {
      panel: findNearestVisualizationPanel(fallbackRenderable) || document.body,
      renderable: fallbackRenderable
    };
  }

  return { panel: null, renderable: null };
}

async function extractVisualizations() {
  const tabs = getVisualizationTabs();
  if (tabs.length === 0) {
    return captureVisibleVisualizationsFallback();
  }

  const originalTab = getActiveVisualizationTab(tabs);
  const dedupeKeys = new Set();
  const charts = [];

  const initialVisible = findRenderableInVisiblePanels();
  if (initialVisible.panel) {
    const activeLabel = (originalTab?.textContent || '').trim() || 'Visualization';
    charts.push(...captureVisualElements(initialVisible.panel, activeLabel, dedupeKeys));
  }

  for (const tab of tabs) {
    const tabLabel = getTabLabel(tab);
    if (!tabLabel) {
      continue;
    }

    if (originalTab === tab && charts.some(chart => chart.title === tabLabel || chart.title.startsWith(`${tabLabel} #`))) {
      continue;
    }

    if (originalTab !== tab) {
      tab.click();
    }
    const panel = resolveTabPanel(tab);
    await waitForVisualizationRender(panel);

    const captureScope = resolveTabPanel(tab) || panel || document;
    charts.push(...captureVisualElements(captureScope, tabLabel, dedupeKeys));
  }

  if (originalTab && originalTab.isConnected) {
    originalTab.click();
    await waitForVisualizationRender(resolveTabPanel(originalTab));
  }

  return charts.length > 0 ? charts : captureVisibleVisualizationsFallback();
}

async function extractTableDataWithTabFallback() {
  const currentTable = extractTableData();
  if (currentTable && currentTable.columns.length > 0 && currentTable.rows.length > 0) {
    return currentTable;
  }

  const tabs = getVisualizationTabs();
  if (tabs.length === 0) {
    return currentTable;
  }

  const originalTab = getActiveVisualizationTab(tabs);
  const tableTabs = tabs.filter((tab) => {
    const label = getTabLabel(tab).toLowerCase();
    return /\b(table|result|results|query result)\b/i.test(label);
  });

  if (tableTabs.length === 0) {
    return currentTable;
  }

  let foundTable = null;

  for (const tab of tableTabs) {
    if (tab !== originalTab) {
      tab.click();
    }
    await wait(220);
    const table = extractTableData();
    if (table && table.columns.length > 0 && table.rows.length > 0) {
      foundTable = table;
      break;
    }
  }

  if (originalTab && originalTab.isConnected) {
    originalTab.click();
    await wait(160);
  }

  return foundTable || currentTable;
}

async function captureResults(showFeedback = false) {
  if (!isActive) return;

  if (Date.now() - lastCaptureTime < 500) {
    return;
  }
  lastCaptureTime = Date.now();

  const currentUrl = window.location.href.split('#')[0];

  const charts = await extractVisualizations();
  const tableData = await extractTableDataWithTabFallback();
  const hasTableData = Boolean(
    tableData && tableData.columns.length > 0 && tableData.rows.length > 0
  );
  const hasCharts = charts.length > 0;

  if (!hasTableData && !hasCharts) {
    if (showFeedback) {
      showFeedbackMessage('No results to capture', 'error');
    }
    return;
  }

  const queryInfo = extractQueryInfo();

  const payload = {
    ...queryInfo,
    columns: hasTableData ? tableData.columns : [],
    rows: hasTableData ? tableData.rows : [],
    charts
  };

  lastCapturedUrl = currentUrl;

  chrome.runtime.sendMessage({
    type: MESSAGES.ADD_RESULT,
    payload
  }, (response) => {
    if (showFeedback) {
      if (response?.success) {
        showFeedbackMessage('Result captured!', 'success');
      } else {
        showFeedbackMessage(response?.error || 'Capture failed', 'error');
      }
    }
  });
}

function showFeedbackMessage(message, type) {
  let toast = document.querySelector('.redashski-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'redashski-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 4px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      z-index: 999999;
      animation: redashski-slide-in 0.3s ease;
    `;
    document.body.appendChild(toast);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes redashski-slide-in {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  toast.textContent = message;
  toast.style.backgroundColor = type === 'success' ? '#06960e' : '#c7060b';
  toast.style.color = 'white';
  toast.style.border = `1px solid ${type === 'success' ? '#057a0b' : '#a80509'}`;

  setTimeout(() => {
    toast.style.animation = 'redashski-slide-in 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function findExecuteButton() {
  const directSelectors = [
    '[data-test="ExecuteQueryButton"]',
    '[data-test="ExecuteButton"]',
    'button[aria-label*="Execute"]'
  ];

  for (const selector of directSelectors) {
    const button = document.querySelector(selector);
    if (button) {
      return button;
    }
  }

  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.find(btn => /\bexecute\b/i.test((btn.textContent || '').trim())) || null;
}

function patchExecuteButton(button) {
  if (!button || button.dataset.redashskiPatched === '1') {
    return;
  }

  button.dataset.redashskiPatched = '1';
  button.dataset.redashskiOriginalHtml = button.innerHTML;
  button.innerHTML = 'Capture + Execute';
  button.title = 'Capture current result, then execute query';

  button.addEventListener('click', () => {
    captureResults(false);
  }, true);
}

function setupExecuteButtonPatch() {
  const applyPatch = () => {
    const executeButton = findExecuteButton();
    if (executeButton) {
      patchExecuteButton(executeButton);
    }
  };

  applyPatch();

  if (executeButtonObserver) {
    executeButtonObserver.disconnect();
  }

  executeButtonObserver = new MutationObserver(() => {
    applyPatch();
  });

  executeButtonObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function setupMutationObserver() {
  if (mutationObserver) {
    mutationObserver.disconnect();
  }

  const resultsContainer = document.querySelector(
    '[data-test="QueryPageResults"], .query-results, .table-responsive, [class*="results"]'
  );

  if (!resultsContainer) {
    const checkInterval = setInterval(() => {
      const container = document.querySelector(
        '[data-test="QueryPageResults"], .query-results, .table-responsive, [class*="results"]'
      );
      if (container) {
        clearInterval(checkInterval);
        observeContainer(container);
      }
    }, 1000);
    return;
  }

  observeContainer(resultsContainer);
}

function observeContainer(container) {
  mutationObserver = new MutationObserver(() => {
    // Intentionally empty — observation kept alive for future use,
    // but captures are only triggered by explicit user action.
  });

  mutationObserver.observe(container, {
    childList: true,
    subtree: true
  });
}

function setupNavigationObserver() {
  if ('navigation' in window) {
    navigation.addEventListener('navigate', (event) => {
      const url = new URL(event.destination.url);
      if (url.pathname.includes('/queries/')) {
        lastCapturedUrl = null;
      }
    });
  } else {
    let lastUrl = window.location.href;
    setInterval(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        lastCapturedUrl = null;
      }
    }, 1000);
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    if (mutationObserver) {
      mutationObserver.disconnect();
    }
    if (executeButtonObserver) {
      executeButtonObserver.disconnect();
    }
  } else {
    setupMutationObserver();
    setupExecuteButtonPatch();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_NOW') {
    captureResults(true);
    sendResponse({ success: true });
    return true;
  }
});

async function init() {
  await checkPermissions();
  setIconState(isActive);

  if (!isActive) {
    return;
  }

  setupNavigationObserver();
  setupMutationObserver();
  setupExecuteButtonPatch();
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
