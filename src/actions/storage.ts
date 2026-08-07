import type { ElementTarget, StoredAction, StoredActionGroup } from '../types';

export const ACTIONS_STORAGE_KEY = 'actions';
export const POLISH_ID = 'polish';
export const DEFAULT_POLISH_PROMPT = '请润色以下文字，使其更专业流畅，保持原意，只返回结果，不要任何解释：\n\n{content}';

export const DEFAULT_POLISH_ACTION: StoredAction = {
  id: POLISH_ID,
  name: '润色',
  prompt: DEFAULT_POLISH_PROMPT,
};

interface LegacyStoredAction extends StoredAction {
  urlPattern?: string;
  target?: ElementTarget | null;
}

function isStoredAction(value: unknown): value is StoredAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Partial<StoredAction>;
  return typeof action.id === 'string'
    && typeof action.name === 'string'
    && typeof action.prompt === 'string';
}

function isStoredActionGroup(value: unknown): value is StoredActionGroup {
  if (!value || typeof value !== 'object') return false;
  const group = value as Partial<StoredActionGroup>;
  return typeof group.url === 'string'
    && typeof group.selector === 'string'
    && Array.isArray(group.actions);
}

export function normalizeActionGroups(value: unknown): StoredActionGroup[] {
  if (!Array.isArray(value)) return [];
  if (value.every(isStoredActionGroup)) {
    return value.map((group) => ({
      url: group.url,
      selector: group.selector,
      actions: group.actions.filter(isStoredAction),
    }));
  }

  const groups = new Map<string, StoredActionGroup>();
  for (const valueItem of value) {
    if (!isStoredAction(valueItem)) continue;
    const item = valueItem as LegacyStoredAction;
    const url = item.urlPattern || '';
    const selector = item.target ? targetToSelector(item.target) : '';
    const key = JSON.stringify([url, selector]);
    const group = groups.get(key) || { url, selector, actions: [] };
    group.actions.push({ id: item.id, name: item.name, prompt: item.prompt });
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function storageGet(): Promise<StoredActionGroup[]> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get({ [ACTIONS_STORAGE_KEY]: [] }, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(normalizeActionGroups(items[ACTIONS_STORAGE_KEY]));
    });
  });
}

function storageSet(groups: StoredActionGroup[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [ACTIONS_STORAGE_KEY]: groups }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function sameBinding(left: Pick<StoredActionGroup, 'url' | 'selector'>, right: Pick<StoredActionGroup, 'url' | 'selector'>): boolean {
  return left.url === right.url && left.selector === right.selector;
}

export function mergePolishAction(groups: StoredActionGroup[]): StoredAction[] {
  const override = groups
    .flatMap((group) => group.actions)
    .find((action) => action.id === POLISH_ID);
  return [{ ...DEFAULT_POLISH_ACTION, prompt: override?.prompt || DEFAULT_POLISH_PROMPT }];
}

export async function getActionGroups(): Promise<StoredActionGroup[]> {
  return storageGet();
}

export async function getActions(): Promise<StoredAction[]> {
  return mergePolishAction(await storageGet());
}

export async function saveActionGroup(
  group: StoredActionGroup,
  previousBinding?: Pick<StoredActionGroup, 'url' | 'selector'>,
): Promise<void> {
  let groups = await storageGet();
  if (previousBinding) {
    groups = groups.filter((item) => !sameBinding(item, previousBinding));
  }

  const normalized: StoredActionGroup = {
    url: group.url,
    selector: group.selector,
    actions: group.actions.map((action) => ({ ...action })),
  };
  if (normalized.actions.length > 0) {
    const existing = groups.find((item) => sameBinding(item, normalized));
    if (existing) {
      for (const action of normalized.actions) {
        const index = existing.actions.findIndex((item) => item.id === action.id);
        if (index === -1) existing.actions.push(action);
        else existing.actions[index] = action;
      }
    } else {
      groups.push(normalized);
    }
  }
  await storageSet(groups.filter((item) => item.actions.length > 0));
}

export async function deleteAction(id: string): Promise<void> {
  if (id === POLISH_ID) return;
  const groups = (await storageGet())
    .map((group) => ({ ...group, actions: group.actions.filter((action) => action.id !== id) }))
    .filter((group) => group.actions.length > 0);
  await storageSet(groups);
}

export async function savePolishAction(prompt: string): Promise<void> {
  const groups = await storageGet();
  const globalGroup = groups.find((group) => group.url === '' && group.selector === '');
  const polish = { ...DEFAULT_POLISH_ACTION, prompt };
  if (globalGroup) {
    globalGroup.actions = [polish, ...globalGroup.actions.filter((action) => action.id !== POLISH_ID)];
  } else {
    groups.unshift({ url: '', selector: '', actions: [polish] });
  }
  await storageSet(groups);
}

export async function resetPolishAction(): Promise<void> {
  const groups = (await storageGet())
    .map((group) => ({ ...group, actions: group.actions.filter((action) => action.id !== POLISH_ID) }))
    .filter((group) => group.actions.length > 0);
  await storageSet(groups);
}

export function urlMatches(pattern: string, url: string): boolean {
  if (!pattern) return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(url);
}

function escapeIdentifier(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (match, digit: string | undefined) =>
    digit ? `\\3${digit} ` : `\\${match}`
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function targetToSelector(target: ElementTarget): string {
  return target.kind === 'id' ? `#${escapeIdentifier(target.value)}` : target.value;
}

export function selectorMatches(el: Element, selector: string): boolean {
  if (!selector) return true;
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

export function elementMatches(el: Element, target: ElementTarget | null): boolean {
  return selectorMatches(el, target ? targetToSelector(target) : '');
}

export function groupMatches(group: StoredActionGroup, url: string, el: Element): boolean {
  return urlMatches(group.url, url) && selectorMatches(el, group.selector);
}

export function getMatchingActionGroup(
  groups: StoredActionGroup[],
  url: string,
  el: Element,
): StoredActionGroup | null {
  return groups.find((group) => group.selector && groupMatches(group, url, el)) || null;
}

export function getMatchingActions(
  groups: StoredActionGroup[],
  url: string,
  el: Element,
): StoredAction[] {
  const customActions = groups
    .filter((group) => group.selector && groupMatches(group, url, el))
    .flatMap((group) => group.actions)
    .filter((action) => action.id !== POLISH_ID);
  return [...mergePolishAction(groups), ...customActions];
}

export function countSelectorMatches(selector: string, doc: Document = document): number {
  try {
    return doc.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

export function countTargetMatches(target: ElementTarget, doc: Document = document): number {
  return countSelectorMatches(targetToSelector(target), doc);
}

function uniqueSelector(selector: string, doc: Document): boolean {
  return countSelectorMatches(selector, doc) === 1;
}

function stableSelectorCandidates(el: Element): string[] {
  const tag = el.tagName.toLowerCase();
  const attributes = ['name', 'type', 'aria-label']
    .map((name) => ({ name, value: el.getAttribute(name) }))
    .filter((attribute): attribute is { name: string; value: string } => Boolean(attribute.value));
  const candidates: string[] = [];
  for (let count = 1; count <= attributes.length; count += 1) {
    candidates.push(tag + attributes.slice(0, count)
      .map(({ name, value }) => `[${name}="${escapeAttribute(value)}"]`)
      .join(''));
  }
  return candidates;
}

function pathSegment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter((child) => child.tagName === el.tagName);
  return `${tag}:nth-of-type(${siblings.indexOf(el) + 1})`;
}

export function generateElementTarget(el: Element, doc: Document = document): ElementTarget {
  if (el.id) {
    const idTarget: ElementTarget = { kind: 'id', value: el.id };
    if (countTargetMatches(idTarget, doc) === 1) return idTarget;
  }

  for (const selector of stableSelectorCandidates(el)) {
    if (uniqueSelector(selector, doc)) {
      return { kind: 'selector', value: selector };
    }
  }

  const segments = [pathSegment(el)];
  let parent = el.parentElement;
  while (parent && parent !== doc.documentElement) {
    segments.unshift(pathSegment(parent));
    const selector = segments.join(' > ');
    if (uniqueSelector(selector, doc)) {
      return { kind: 'selector', value: selector };
    }
    parent = parent.parentElement;
  }

  if (parent === doc.documentElement) {
    segments.unshift(parent.tagName.toLowerCase());
  }
  return { kind: 'selector', value: segments.join(' > ') };
}
