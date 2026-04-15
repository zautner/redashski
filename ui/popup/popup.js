const MESSAGES = {
  GET_HISTORY: 'GET_HISTORY',
  CLEAR_HISTORY: 'CLEAR_HISTORY',
  DELETE_HISTORY_ITEM: 'DELETE_HISTORY_ITEM',
  GET_PERMITTED_URLS: 'GET_PERMITTED_URLS',
  SET_PERMITTED_URLS: 'SET_PERMITTED_URLS',
  GET_SETTINGS: 'GET_SETTINGS',
  SET_SETTINGS: 'SET_SETTINGS',
  OPEN_SIDE_PANEL: 'OPEN_SIDE_PANEL',
  TOGGLE_SIDE_PANEL: 'TOGGLE_SIDE_PANEL',
  GET_SIDE_PANEL_STATE: 'GET_SIDE_PANEL_STATE',
  REQUEST_HOST_PERMISSIONS: 'REQUEST_HOST_PERMISSIONS'
};

const DEFAULT_QUEUE_SIZE = 10;
const MIN_QUEUE_SIZE = 1;
const MAX_QUEUE_SIZE = 100;

let activeTabId = null;

function normalizeQueueSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_QUEUE_SIZE;
  }
  return Math.max(MIN_QUEUE_SIZE, Math.min(MAX_QUEUE_SIZE, parsed));
}

function urlPrefixToMatchPattern(prefix) {
  try {
    const url = new URL(prefix);
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

function showStatus(message, type = '') {
  const statusText = document.getElementById('statusText');
  statusText.textContent = message;
  statusText.className = `status-text ${type}`;
  setTimeout(() => {
    statusText.textContent = '';
    statusText.className = 'status-text';
  }, 3000);
}

async function loadSettings() {
  const [{ permittedUrls = [] }, { settings = {} }] = await Promise.all([
    chrome.runtime.sendMessage({ type: MESSAGES.GET_PERMITTED_URLS }),
    chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS })
  ]);

  document.getElementById('permittedUrls').value = permittedUrls.join('\n');
  document.getElementById('queueSize').value = normalizeQueueSize(settings.queueSize ?? DEFAULT_QUEUE_SIZE);
}

async function saveSettings() {
  const urls = document.getElementById('permittedUrls').value
    .split('\n')
    .map(url => url.trim())
    .filter(url => url.length > 0);

  const queueSize = normalizeQueueSize(document.getElementById('queueSize').value);
  document.getElementById('queueSize').value = queueSize;

  // Request host permissions for the URLs (must be in user gesture context)
  const patterns = urls
    .map(urlPrefixToMatchPattern)
    .filter(Boolean);

  let permissionGranted = true;
  if (patterns.length > 0) {
    try {
      permissionGranted = await chrome.permissions.request({ origins: patterns });
    } catch {
      permissionGranted = false;
    }
  }

  await Promise.all([
    chrome.runtime.sendMessage({ type: MESSAGES.SET_PERMITTED_URLS, urls }),
    chrome.runtime.sendMessage({ type: MESSAGES.SET_SETTINGS, settings: { queueSize } })
  ]);

  // Tell background to re-register content scripts for granted hosts
  await chrome.runtime.sendMessage({ type: MESSAGES.REQUEST_HOST_PERMISSIONS }).catch(() => {});

  if (permissionGranted) {
    showStatus('Settings saved', 'success');
  } else {
    showStatus('Saved — some hosts not permitted by browser', 'error');
  }
}


async function toggleSidePanel() {
  if (typeof activeTabId !== 'number') {
    showStatus('No active tab', 'error');
    return;
  }

  try {
    // Check current state first (no gesture needed for this read)
    const stateResponse = await chrome.runtime.sendMessage({
      type: MESSAGES.GET_SIDE_PANEL_STATE,
      tabId: activeTabId
    });
    const isOpen = stateResponse?.isOpen ?? false;

    if (isOpen) {
      // close() doesn't need a gesture
      await chrome.runtime.sendMessage({
        type: MESSAGES.TOGGLE_SIDE_PANEL,
        tabId: activeTabId
      });
    } else {
      // open() MUST be called synchronously in the gesture handler —
      // call it directly here in the popup, not via the background
      await chrome.sidePanel.open({ tabId: activeTabId });
      // Notify background so it updates its tracking state
      chrome.runtime.sendMessage({
        type: MESSAGES.TOGGLE_SIDE_PANEL,
        tabId: activeTabId,
        forceOpen: true
      }).catch(() => {});
    }

    window.close();
  } catch (err) {
    showStatus('Could not toggle side panel', 'error');
  }
}

async function updateSidePanelButton() {
  const btn = document.getElementById('openSidePanel');
  if (!btn || typeof activeTabId !== 'number') return;
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGES.GET_SIDE_PANEL_STATE,
      tabId: activeTabId
    });
    const isOpen = response?.isOpen ?? false;
    btn.title = isOpen ? 'Close Side Panel' : 'Open Side Panel';
    btn.classList.toggle('active', isOpen);
  } catch {
    // ignore
  }
}

async function snapNow() {
  const snapBtn = document.getElementById('snapNow');
  snapBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab?.id ?? null;

    if (!tab) {
      showStatus('No active tab', 'error');
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_NOW' });

    if (response?.success) {
      showStatus('Snapped!', 'success');
    } else {
      showStatus('Snap failed - not on Redash', 'error');
    }
  } catch (error) {
    showStatus('Snap failed - is Redash open?', 'error');
  } finally {
    snapBtn.disabled = false;
  }
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

document.addEventListener('DOMContentLoaded', async () => {
  applyLocalization();
  await loadVersion();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;

  document.getElementById('snapNow').addEventListener('click', snapNow);
  document.getElementById('openSidePanel').addEventListener('click', toggleSidePanel);
  await updateSidePanelButton();
  document.getElementById('openSettings').addEventListener('click', () => {
    document.getElementById('permittedUrls').focus();
  });
  await loadSettings();
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
});
