const STORAGE_KEY = 'disabledInjectionRules';

type Rules = { pages: string[]; sites: string[] };

async function readRules(): Promise<Rules> {
  const result = await chrome.storage.local.get({ [STORAGE_KEY]: { pages: [], sites: [] } });
  const value = result[STORAGE_KEY] as Partial<Rules>;
  return { pages: Array.isArray(value?.pages) ? value.pages : [], sites: Array.isArray(value?.sites) ? value.sites : [] };
}
export async function getDisableRules(): Promise<Rules> { return readRules(); }

export function pageKey(url: string): string { return url; }
export function siteKey(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
}

export async function getDisableState(url: string): Promise<{ page: boolean; site: boolean }> {
  const rules = await readRules();
  const site = siteKey(url);
  return { page: rules.pages.includes(pageKey(url)), site: !!site && rules.sites.includes(site) };
}

export async function setDisableRule(url: string, scope: 'page' | 'site', disabled: boolean): Promise<void> {
  const rules = await readRules();
  const key = scope === 'page' ? pageKey(url) : siteKey(url);
  if (!key) return;
  const list = scope === 'page' ? rules.pages : rules.sites;
  const next = disabled ? [...new Set([...list, key])] : list.filter((item) => item !== key);
  await chrome.storage.local.set({ [STORAGE_KEY]: scope === 'page' ? { ...rules, pages: next } : { ...rules, sites: next } });
}
