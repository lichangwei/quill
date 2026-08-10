import { readLabeledField } from './dom-reader';
import { matchByFingerprint } from './fingerprint';
import type { ElementFingerprint } from '../types';

export interface SelectedElementResult {
  found: boolean;
  value: string;
}

/**
 * 按 selector 定位元素，支持 iframe / shadow DOM 的 `>>>` 分段。
 * 主 selector 的最后一段失效时，用指纹在其所在 root 内降级匹配。
 */
function resolveElement(selector: string, fallback?: ElementFingerprint): Element | null {
  const selectorParts = selector.split(/\s+>>>\s+/).map((part) => part.trim()).filter(Boolean);
  let root: Document | ShadowRoot = document;
  let element: Element | null = null;
  try {
    for (let index = 0; index < selectorParts.length; index += 1) {
      const isLast = index === selectorParts.length - 1;
      element = root.querySelector(selectorParts[index]);
      // 仅对最后一段（目标元素本身）降级；中间的 iframe/shadow 宿主无指纹信息。
      if (!element && isLast) element = matchByFingerprint(fallback, root);
      if (!element) return null;
      if (element instanceof HTMLIFrameElement) {
        root = element.contentDocument || document;
      } else if (element.shadowRoot) {
        root = element.shadowRoot;
      }
    }
  } catch {
    // selector 语法非法：整条链不可信，用指纹在全局兜底（指纹要求唯一命中，误配风险低）。
    return matchByFingerprint(fallback, document);
  }
  return element;
}

export function readSelectedElement(selector: string, fallback?: ElementFingerprint): SelectedElementResult {
  const element = resolveElement(selector, fallback);
  if (!element) return { found: false, value: '' };
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return { found: true, value: element.value.trim() };
  }
  if (element instanceof HTMLIFrameElement) {
    try {
      return { found: true, value: (element.contentDocument?.body.innerText || '').trim() };
    } catch {
      return { found: true, value: '' };
    }
  }
  if (element instanceof HTMLElement) {
    if (element.isContentEditable || (element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false')) {
      return { found: true, value: element.innerHTML.trim() };
    }
    return { found: true, value: (element.innerText || element.textContent || '').trim() };
  }
  return { found: true, value: (element.textContent || '').trim() };
}

export async function readPageContent(
  description: string,
  selector?: string,
  fallback?: ElementFingerprint,
): Promise<string> {
  if (selector) {
    const selectedElement = readSelectedElement(selector, fallback);
    console.info('[Quill] 从左侧页面读取元素', {
      pageUrl: location.href,
      selector,
      found: selectedElement.found,
      valueLength: selectedElement.value.length,
    });
    if (selectedElement.found) return selectedElement.value;
    throw new Error(`在左侧页面中未找到已选择元素“${selector}”，请重新选择`);
  }
  const localValue = readLabeledField(description);
  if (localValue) return localValue;
  throw new Error(`未找到页面字段“${description}”，请在侧边栏中重新选择该元素`);
}
