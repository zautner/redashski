export const STORAGE_KEYS = {
  HISTORY_BY_TAB: 'historyByTab',
  PERMITTED_URLS: 'permittedUrls',
  SETTINGS: 'settings'
};

export const DEFAULT_QUEUE_SIZE = 10;
export const MIN_QUEUE_SIZE = 1;
export const MAX_QUEUE_SIZE = 100;

export const MESSAGES = {
  ADD_RESULT: 'ADD_RESULT',
  GET_HISTORY: 'GET_HISTORY',
  CLEAR_HISTORY: 'CLEAR_HISTORY',
  DELETE_HISTORY_ITEM: 'DELETE_HISTORY_ITEM',
  GET_PERMITTED_URLS: 'GET_PERMITTED_URLS',
  SET_PERMITTED_URLS: 'SET_PERMITTED_URLS',
  GET_SETTINGS: 'GET_SETTINGS',
  SET_SETTINGS: 'SET_SETTINGS',
  CHECK_URL: 'CHECK_URL',
  OPEN_SIDE_PANEL: 'OPEN_SIDE_PANEL',
  TOGGLE_SIDE_PANEL: 'TOGGLE_SIDE_PANEL',
  GET_SIDE_PANEL_STATE: 'GET_SIDE_PANEL_STATE',
  REQUEST_HOST_PERMISSIONS: 'REQUEST_HOST_PERMISSIONS'
};

export const REDASH_SELECTORS = {
  RESULTS_CONTAINER: '[data-test="QueryPageResults"]',
  LOADER: '[data-test="QueryPageLoader"]',
  LOADER_HIDDEN: '[data-test="QueryPageLoader"][style*="display: none"]',
  TABLE: '.table-responsive table',
  QUERY_TITLE: '[data-test="QueryTitle"]',
  QUERY_LINK: 'a[href*="/queries/"]'
};
