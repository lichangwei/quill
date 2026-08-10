import { finder } from '@medv/finder';
import * as Types from '../types';

type EditorState = Types.EditorState;
type ElementTarget = Types.ElementTarget;
type StoredAction = Types.StoredAction;
type StoredActionGroup = Types.StoredActionGroup;
type PageElementReference = Types.PageElementReference;

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

function normalizeFingerprint(value: unknown): Types.ElementFingerprint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const fingerprint: Types.ElementFingerprint = {};
  if (typeof source.tagName === 'string') fingerprint.tagName = source.tagName;
  if (typeof source.text === 'string') fingerprint.text = source.text;
  if (source.attributes && typeof source.attributes === 'object') {
    const attributes: Record<string, string> = {};
    for (const [name, attrValue] of Object.entries(source.attributes as Record<string, unknown>)) {
      if (typeof attrValue === 'string') attributes[name] = attrValue;
    }
    if (Object.keys(attributes).length) fingerprint.attributes = attributes;
  }
  return fingerprint.tagName || fingerprint.text || fingerprint.attributes ? fingerprint : undefined;
}

function normalizePageReferences(value: unknown): PageElementReference[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is PageElementReference => Boolean(item) && typeof item === 'object'
    && typeof (item as Partial<PageElementReference>).name === 'string'
    && typeof (item as Partial<PageElementReference>).selector === 'string')
    .map((item) => {
      const fallback = normalizeFingerprint((item as PageElementReference).fallback);
      return { name: item.name, selector: item.selector, ...(fallback ? { fallback } : {}) };
    });
}

function normalizeStoredAction(action: StoredAction): StoredAction {
  return {
    id: action.id,
    name: action.name,
    prompt: action.prompt,
    pageReferences: normalizePageReferences(action.pageReferences),
  };
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
      actions: group.actions.filter(isStoredAction).map(normalizeStoredAction),
      ...(group.pageName ? { pageName: group.pageName } : {}),
      ...(group.fieldName ? { fieldName: group.fieldName } : {}),
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
    group.actions.push(normalizeStoredAction(item));
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
  return [{ ...DEFAULT_POLISH_ACTION, prompt: override?.prompt || DEFAULT_POLISH_PROMPT,
    pageReferences: override?.pageReferences?.map((reference) => ({ ...reference })) }];
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
    actions: group.actions.map((action) => ({ ...action,
      pageReferences: action.pageReferences?.map((reference) => ({ ...reference })) })),
    ...(group.pageName ? { pageName: group.pageName } : {}),
    ...(group.fieldName ? { fieldName: group.fieldName } : {}),
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

export async function savePolishAction(prompt: string, pageReferences?: StoredAction['pageReferences']): Promise<void> {
  const groups = await storageGet();
  const globalGroup = groups.find((group) => group.url === '' && group.selector === '');
  const existingPolish = groups.flatMap((group) => group.actions).find((action) => action.id === POLISH_ID);
  const polish = { ...DEFAULT_POLISH_ACTION, prompt,
    pageReferences: (pageReferences ?? existingPolish?.pageReferences)?.map((reference) => ({ ...reference })) };
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

export function selectorToTarget(selector: string): ElementTarget {
  const idMatch = /^#([\w-]+)$/.exec(selector);
  return idMatch ? { kind: 'id', value: idMatch[1] } : { kind: 'selector', value: selector };
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

/**
 * 返回当前页面（按 URL 规则）已配置的元素分组，用于侧边栏列表视图。
 * 排除全局润色组（selector 为空），仅按 URL 匹配，不依赖具体 DOM 元素。
 */
export function getPageActionGroups(groups: StoredActionGroup[], url: string): StoredActionGroup[] {
  return groups.filter((group) => group.selector && urlMatches(group.url, url));
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

export function buildEditorState(
  groups: StoredActionGroup[],
  url: string,
  el: Element,
): EditorState {
  const target = generateElementTarget(el);
  const group = getMatchingActionGroup(groups, url, el);
  const pageName = typeof document !== 'undefined' ? document.title.trim() : '';
  const fieldName = getElementName(el);
  return {
    url: group?.url || url,
    selector: group?.selector || targetToSelector(target),
    target,
    group,
    ...(pageName ? { pageName } : {}),
    ...(fieldName !== '输入框' ? { fieldName } : {}),
  };
}

function getElementName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;
  if (el.id && typeof document !== 'undefined') {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const closestLabel = el.closest('label')?.textContent?.trim();
  if (closestLabel) return closestLabel;
  const placeholder = el.getAttribute('placeholder')?.trim();
  if (placeholder) return placeholder;
  const name = el.getAttribute('name')?.trim();
  return name || '输入框';
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

// 编译生成、不稳定的 id：随机 hash、框架自增 id（ember/react/radix/mui/:r..）、纯数字开头。
const UNSTABLE_ID = /^\d|[0-9a-f]{6,}|^(ember|react|radix|mui-|:r|headlessui|aria-|el-id-|__)/i;
// 编译生成的 class：CSS-in-JS（css-/sc-/jsx-/emotion）、含 hash、以及超长串。
const UNSTABLE_CLASS = /^(css-|sc-|jsx-|emotion-|_)|[0-9a-f]{5,}/i;
// 优先信任的语义属性，稳定性远高于 class。
const STABLE_ATTR = /^(data-testid|data-test|data-qa|data-cy|data-id|name|role|type|aria-label|placeholder)$/;

/**
 * 用 @medv/finder 生成尽量稳定、唯一的 CSS selector。
 * 过滤掉易变的 class/id，优先语义属性。失败或结果不唯一时返回 null，交由调用方回退。
 */
function finderSelector(el: Element, doc: Document): string | null {
  const root = el.getRootNode();
  // shadow DOM 内的元素以其 ShadowRoot 为查询根，生成相对 selector（下游按 >>> 分段查询）。
  const scope: Document | ShadowRoot = root instanceof ShadowRoot ? root : doc;
  const rootElement = scope instanceof ShadowRoot ? scope : scope.documentElement;
  if (!rootElement) return null;
  try {
    const selector = finder(el, {
      root: rootElement as unknown as Element,
      idName: (name) => !UNSTABLE_ID.test(name),
      className: (name) => !UNSTABLE_CLASS.test(name) && name.length < 30,
      tagName: () => true,
      attr: (name) => STABLE_ATTR.test(name),
      timeoutMs: 500,
    });
    // finder 保证在 root 内唯一，仍在同一 scope 内复核，防止极端情况漏判。
    return selector && scope.querySelectorAll(selector).length === 1 ? selector : null;
  } catch {
    return null;
  }
}

export function generateElementTarget(el: Element, doc: Document = document): ElementTarget {
  if (el.id) {
    const idTarget: ElementTarget = { kind: 'id', value: el.id };
    if (!UNSTABLE_ID.test(el.id) && countTargetMatches(idTarget, doc) === 1) return idTarget;
  }

  const generated = finderSelector(el, doc);
  if (generated) return { kind: 'selector', value: generated };

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
