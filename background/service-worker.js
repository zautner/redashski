import {
  STORAGE_KEYS,
  DEFAULT_QUEUE_SIZE,
  MIN_QUEUE_SIZE,
  MAX_QUEUE_SIZE,
  MESSAGES
} from '../shared/storage-keys.js';
import { isUrlPermitted, setPermittedUrls, getPermittedUrls, urlPrefixToMatchPattern } from './url-validator.js';

// Track which windows currently have the side panel open
const openPanelWindowIds = new Set();

if (chrome.sidePanel.onPanelClosed) {
  chrome.sidePanel.onPanelClosed.addListener((details) => {
    if (typeof details.windowId === 'number') {
      openPanelWindowIds.delete(details.windowId);
    }
  });
}

const CONTENT_SCRIPT_ID = 'redashski-content';

async function getGrantedMatchPatterns(urls) {
  const patterns = urls
    .map(urlPrefixToMatchPattern)
    .filter(Boolean);

  if (patterns.length === 0) {
    return [];
  }

  const granted = [];
  for (const pattern of patterns) {
    try {
      const has = await chrome.permissions.contains({ origins: [pattern] });
      if (has) {
        granted.push(pattern);
      }
    } catch {
      // skip invalid patterns
    }
  }
  return granted;
}

async function registerContentScripts(matchPatterns) {
  // Unregister existing first
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  } catch {
    // may not exist yet
  }

  if (matchPatterns.length === 0) {
    return;
  }

  try {
    await chrome.scripting.registerContentScripts([{
      id: CONTENT_SCRIPT_ID,
      matches: matchPatterns,
      js: ['content/content-script.js'],
      runAt: 'document_idle'
    }]);
  } catch (error) {
    console.warn('Failed to register content scripts:', error);
  }
}

async function syncContentScriptRegistration() {
  const urls = await getPermittedUrls();
  const patterns = await getGrantedMatchPatterns(urls);
  await registerContentScripts(patterns);
  return patterns;
}

async function injectIntoMatchingTabs(matchPatterns) {
  if (matchPatterns.length === 0) return;

  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || !tab.url) continue;
    const matches = matchPatterns.some(pattern => {
      try {
        const patternUrl = new URL(pattern.replace('/*', '/'));
        return tab.url.startsWith(patternUrl.origin);
      } catch {
        return false;
      }
    });
    if (matches) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/content-script.js']
        });
      } catch {
        // tab may not be injectable (chrome://, etc.)
      }
    }
  }
}

function createIconImageData(size, isActive) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d');

  context.clearRect(0, 0, size, size);

  context.fillStyle = '#f0f0f0';
  context.fillRect(0, 0, size, size);

  context.fillStyle = '#6B72E6';
  const inset = Math.max(1, Math.round(size * 0.12));
  const innerSize = size - inset * 2;
  context.fillRect(inset, inset, innerSize, innerSize);

  context.fillStyle = '#ffffff';
  const bandWidth = Math.max(1, Math.round(size * 0.14));
  context.fillRect(Math.round(size * 0.5) - Math.floor(bandWidth / 2), inset, bandWidth, innerSize);

  if (isActive) {
    context.strokeStyle = '#06960e';
    context.lineWidth = Math.max(2, Math.round(size * 0.14));
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(size * 0.2, size * 0.55);
    context.lineTo(size * 0.4, size * 0.75);
    context.lineTo(size * 0.78, size * 0.28);
    context.stroke();
  }

  return context.getImageData(0, 0, size, size);
}

function getIconImageDataSet(isActive) {
  return {
    16: createIconImageData(16, isActive),
    32: createIconImageData(32, isActive),
    48: createIconImageData(48, isActive),
    128: createIconImageData(128, isActive)
  };
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function normalizeQueueSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_QUEUE_SIZE;
  }
  return Math.max(MIN_QUEUE_SIZE, Math.min(MAX_QUEUE_SIZE, parsed));
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const queueSize = normalizeQueueSize(settings.queueSize ?? DEFAULT_QUEUE_SIZE);
  return { queueSize };
}

async function setSettings(newSettings = {}) {
  const current = await getSettings();
  const merged = {
    ...current,
    ...newSettings,
    queueSize: normalizeQueueSize(newSettings.queueSize ?? current.queueSize)
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

async function getHistoryByTabMap() {
  const { historyByTab = {} } = await chrome.storage.local.get(STORAGE_KEYS.HISTORY_BY_TAB);
  return historyByTab;
}

async function saveHistoryByTabMap(historyByTab) {
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY_BY_TAB]: historyByTab });
}

function ensureTabHistory(map, tabId) {
  const key = String(tabId);
  if (!Array.isArray(map[key])) {
    map[key] = [];
  }
  return map[key];
}

async function addResult(tabId, result) {
  const historyByTab = await getHistoryByTabMap();
  const tabHistory = ensureTabHistory(historyByTab, tabId);
  const { queueSize } = await getSettings();

  const newEntry = {
    id: generateId(),
    timestamp: Date.now(),
    queryId: result.queryId,
    queryName: result.queryName,
    resultUrl: result.resultUrl,
    columns: result.columns,
    rows: result.rows,
    charts: Array.isArray(result.charts) ? result.charts : []
  };

  tabHistory.unshift(newEntry);
  historyByTab[String(tabId)] = tabHistory.slice(0, queueSize);

  await saveHistoryByTabMap(historyByTab);
  return historyByTab[String(tabId)];
}

async function getHistory(tabId) {
  const historyByTab = await getHistoryByTabMap();
  return historyByTab[String(tabId)] || [];
}

async function clearHistory(tabId) {
  const historyByTab = await getHistoryByTabMap();
  historyByTab[String(tabId)] = [];
  await saveHistoryByTabMap(historyByTab);
  return [];
}

async function deleteHistoryItem(tabId, id) {
  const historyByTab = await getHistoryByTabMap();
  const tabKey = String(tabId);
  const tabHistory = historyByTab[tabKey] || [];
  historyByTab[tabKey] = tabHistory.filter(item => item.id !== id);
  await saveHistoryByTabMap(historyByTab);
  return historyByTab[tabKey];
}

async function trimAllQueuesToSize(queueSize) {
  const normalizedSize = normalizeQueueSize(queueSize);
  const historyByTab = await getHistoryByTabMap();
  let changed = false;

  Object.keys(historyByTab).forEach(tabKey => {
    const list = Array.isArray(historyByTab[tabKey]) ? historyByTab[tabKey] : [];
    const trimmed = list.slice(0, normalizedSize);
    if (trimmed.length !== list.length) {
      changed = true;
    }
    historyByTab[tabKey] = trimmed;
  });

  if (changed) {
    await saveHistoryByTabMap(historyByTab);
  }
}

const STORAGE_QUOTA_WARN_BYTES = 8 * 1024 * 1024; // 8 MB

async function enforceStorageQuota() {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  if (bytesInUse < STORAGE_QUOTA_WARN_BYTES) {
    return;
  }

  // Evict oldest entries across all tabs until under threshold
  const historyByTab = await getHistoryByTabMap();
  let changed = false;

  while (true) {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [tabKey, entries] of Object.entries(historyByTab)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const last = entries[entries.length - 1];
      if (last.timestamp < oldestTime) {
        oldestTime = last.timestamp;
        oldestKey = tabKey;
      }
    }

    if (!oldestKey) break;

    historyByTab[oldestKey].pop();
    if (historyByTab[oldestKey].length === 0) {
      delete historyByTab[oldestKey];
    }
    changed = true;

    // Re-check size estimate (rough: JSON size ≈ storage bytes)
    const estimatedSize = JSON.stringify(historyByTab).length * 2;
    if (estimatedSize < STORAGE_QUOTA_WARN_BYTES) break;
  }

  if (changed) {
    await saveHistoryByTabMap(historyByTab);
  }
}

async function setIconState(tabId, isActive) {
  try {
    await chrome.action.setIcon({ tabId, imageData: getIconImageDataSet(isActive) });
  } catch (error) {
    console.warn('Failed to set icon:', error);
  }
}

async function setSidePanelState(tabId, isEnabled) {
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'ui/sidepanel/sidepanel.html',
      enabled: isEnabled
    });
  } catch (error) {
    console.warn('Failed to set side panel state:', error);
  }
}

async function syncTabState(tabId, url) {
  const active = await isUrlPermitted(url || '');
  await setIconState(tabId, active);
  await setSidePanelState(tabId, active);
  return active;
}

async function getFallbackTabId() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id;
}

async function resolveTabId(sender, message) {
  if (typeof sender.tab?.id === 'number') {
    return sender.tab.id;
  }
  if (typeof message.tabId === 'number') {
    return message.tabId;
  }
  return getFallbackTabId();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const currentUrl = sender.tab?.url || message.url || '';
      const senderTabId = sender.tab?.id;

      switch (message.type) {
        case MESSAGES.ADD_RESULT: {
          const targetTabId = await resolveTabId(sender, message);
          if (typeof targetTabId !== 'number') {
            sendResponse({ success: false, error: 'No tab context available' });
            break;
          }

          if (!(await isUrlPermitted(currentUrl))) {
            sendResponse({ success: false, error: 'URL not permitted' });
            break;
          }

          const history = await addResult(targetTabId, message.payload);
          await enforceStorageQuota();
          sendResponse({ success: true, history, tabId: targetTabId });
          break;
        }

        case MESSAGES.GET_HISTORY: {
          const targetTabId = await resolveTabId(sender, message);
          if (typeof targetTabId !== 'number') {
            sendResponse({ history: [], tabId: null });
            break;
          }
          const history = await getHistory(targetTabId);
          sendResponse({ history, tabId: targetTabId });
          break;
        }

        case MESSAGES.CLEAR_HISTORY: {
          const targetTabId = await resolveTabId(sender, message);
          if (typeof targetTabId !== 'number') {
            sendResponse({ success: false, error: 'No tab context available' });
            break;
          }
          await clearHistory(targetTabId);
          sendResponse({ success: true, tabId: targetTabId });
          break;
        }

        case MESSAGES.DELETE_HISTORY_ITEM: {
          const targetTabId = await resolveTabId(sender, message);
          if (typeof targetTabId !== 'number') {
            sendResponse({ success: false, error: 'No tab context available' });
            break;
          }
          const history = await deleteHistoryItem(targetTabId, message.id);
          sendResponse({ success: true, history, tabId: targetTabId });
          break;
        }

        case MESSAGES.GET_PERMITTED_URLS: {
          const { permittedUrls = [] } = await chrome.storage.local.get(STORAGE_KEYS.PERMITTED_URLS);
          sendResponse({ permittedUrls });
          break;
        }

        case MESSAGES.SET_PERMITTED_URLS: {
          const validUrls = await setPermittedUrls(message.urls || []);
          const patterns = await syncContentScriptRegistration();
          await injectIntoMatchingTabs(patterns);
          const tabs = await chrome.tabs.query({});
          await Promise.all(
            tabs
              .filter(tab => typeof tab.id === 'number')
              .map(tab => syncTabState(tab.id, tab.url || ''))
          );
          sendResponse({ success: true, permittedUrls: validUrls });
          break;
        }

        case MESSAGES.GET_SETTINGS: {
          const settings = await getSettings();
          sendResponse({ settings });
          break;
        }

        case MESSAGES.SET_SETTINGS: {
          const settings = await setSettings(message.settings || {});
          await trimAllQueuesToSize(settings.queueSize);
          sendResponse({ success: true, settings });
          break;
        }

        case MESSAGES.OPEN_SIDE_PANEL:
        case MESSAGES.TOGGLE_SIDE_PANEL: {
          const targetTabId = await resolveTabId(sender, message);
          let urlToCheck = currentUrl;

          if ((!urlToCheck || urlToCheck.startsWith('chrome-extension://')) && typeof targetTabId === 'number') {
            const tab = await chrome.tabs.get(targetTabId);
            urlToCheck = tab?.url || '';
          }

          if (!(await isUrlPermitted(urlToCheck))) {
            sendResponse({ success: false, error: 'Side panel is only enabled on permitted Redash URLs' });
            break;
          }

          const windowId = sender.tab?.windowId ?? message.windowId ??
            (typeof targetTabId === 'number' ? (await chrome.tabs.get(targetTabId))?.windowId : undefined);

          if (typeof windowId !== 'number') {
            sendResponse({ success: false, error: 'Could not determine window' });
            break;
          }

          // forceOpen: popup already called sidePanel.open() directly (gesture constraint);
          // just record the state here without calling open() again.
          if (message.forceOpen) {
            openPanelWindowIds.add(windowId);
            sendResponse({ success: true, isOpen: true });
            break;
          }

          const isOpen = openPanelWindowIds.has(windowId);
          if (isOpen) {
            try {
              await chrome.sidePanel.close({ windowId });
              openPanelWindowIds.delete(windowId);
              sendResponse({ success: true, isOpen: false });
            } catch {
              // close() not available in this Chrome version — nothing to do
              openPanelWindowIds.delete(windowId);
              sendResponse({ success: true, isOpen: false });
            }
          } else {
            // This path is only reached from non-popup callers (e.g. content script)
            // which have their own gesture context or don't need one for close.
            openPanelWindowIds.add(windowId);
            sendResponse({ success: true, isOpen: true });
          }
          break;
        }

        case MESSAGES.GET_SIDE_PANEL_STATE: {
          const targetTabId = await resolveTabId(sender, message);
          const windowId = message.windowId ??
            (typeof targetTabId === 'number' ? (await chrome.tabs.get(targetTabId))?.windowId : undefined);
          sendResponse({ isOpen: typeof windowId === 'number' && openPanelWindowIds.has(windowId) });
          break;
        }

        case MESSAGES.CHECK_URL: {
          const permitted = await isUrlPermitted(message.url || currentUrl);
          sendResponse({ permitted });
          break;
        }

        case 'SET_ACTIVE_STATE': {
          if (typeof senderTabId === 'number') {
            await setIconState(senderTabId, message.isActive);
          }
          sendResponse({ success: true });
          break;
        }

        case MESSAGES.REQUEST_HOST_PERMISSIONS: {
          // After permissions are granted by the UI, re-sync content script registration
          const patterns = await syncContentScriptRegistration();
          await injectIntoMatchingTabs(patterns);
          sendResponse({ success: true, patterns });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Message handler failed:', error);
      sendResponse({ success: false, error: error?.message || 'Unhandled background error' });
    }
  })();

  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const { permittedUrls } = await chrome.storage.local.get(STORAGE_KEYS.PERMITTED_URLS);
  if (!Array.isArray(permittedUrls)) {
    await chrome.storage.local.set({ [STORAGE_KEYS.PERMITTED_URLS]: [] });
  }

  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  if (!settings || typeof settings.queueSize !== 'number') {
    await chrome.storage.local.set({
      [STORAGE_KEYS.SETTINGS]: {
        queueSize: DEFAULT_QUEUE_SIZE
      }
    });
  }

  const { historyByTab } = await chrome.storage.local.get(STORAGE_KEYS.HISTORY_BY_TAB);
  if (!historyByTab || typeof historyByTab !== 'object') {
    await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY_BY_TAB]: {} });
  }

  const patterns = await syncContentScriptRegistration();
  await injectIntoMatchingTabs(patterns);

  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter(tab => typeof tab.id === 'number')
      .map(tab => syncTabState(tab.id, tab.url || ''))
  );
});

chrome.runtime.onStartup.addListener(async () => {
  await syncContentScriptRegistration();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const historyByTab = await getHistoryByTabMap();
  const key = String(tabId);
  if (Object.prototype.hasOwnProperty.call(historyByTab, key)) {
    delete historyByTab[key];
    await saveHistoryByTabMap(historyByTab);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  const permitted = await syncTabState(activeInfo.tabId, tab?.url || '');
  chrome.runtime.sendMessage({
    type: 'TAB_ACTIVATED',
    tabId: activeInfo.tabId,
    permitted
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab?.url) {
    const permitted = await syncTabState(tabId, tab.url);
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id === tabId) {
      chrome.runtime.sendMessage({
        type: 'TAB_ACTIVATED',
        tabId,
        permitted
      }).catch(() => {});
    }
  }
});
