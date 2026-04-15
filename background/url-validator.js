import { STORAGE_KEYS } from '../shared/storage-keys.js';

export async function isUrlPermitted(url) {
  const { permittedUrls = [] } = await chrome.storage.local.get(STORAGE_KEYS.PERMITTED_URLS);
  const target = String(url || '').trim();

  if (!permittedUrls || permittedUrls.length === 0) {
    return false;
  }

  return permittedUrls.some((prefixValue) => {
    const prefix = String(prefixValue || '').trim();
    if (!prefix) {
      return false;
    }

    if (target.startsWith(prefix)) {
      return true;
    }

    const withoutTrailingSlash = prefix.replace(/\/+$/, '');
    return withoutTrailingSlash ? target.startsWith(`${withoutTrailingSlash}/`) : false;
  });
}

export function validateUrlPrefix(prefix) {
  try {
    const url = new URL(prefix);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function getPermittedUrls() {
  const { permittedUrls = [] } = await chrome.storage.local.get(STORAGE_KEYS.PERMITTED_URLS);
  return permittedUrls;
}

export async function setPermittedUrls(urls) {
  const validUrls = urls
    .map(url => String(url || '').trim())
    .filter(url => validateUrlPrefix(url));
  await chrome.storage.local.set({ [STORAGE_KEYS.PERMITTED_URLS]: validUrls });
  return validUrls;
}

export function urlPrefixToMatchPattern(prefix) {
  try {
    const url = new URL(prefix);
    const origin = url.origin;
    return `${origin}/*`;
  } catch {
    return null;
  }
}
