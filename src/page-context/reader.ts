import { readLabeledField } from './dom-reader';

export interface SelectedElementResult {
  found: boolean;
  value: string;
}

export function readSelectedElement(selector: string): SelectedElementResult {
  const selectorParts = selector.split(/\s+>>>\s+/).map((part) => part.trim()).filter(Boolean);
  let root: Document | ShadowRoot = document;
  let element: Element | null = null;
  try {
    for (const selectorPart of selectorParts) {
      element = root.querySelector(selectorPart);
      if (!element) return { found: false, value: '' };
      if (element instanceof HTMLIFrameElement) {
        root = element.contentDocument || document;
      } else if (element.shadowRoot) {
        root = element.shadowRoot;
      }
    }
  } catch {
    return { found: false, value: '' };
  }
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

export async function readPageContent(description: string, selector?: string): Promise<string> {
  if (selector) {
    const selectedElement = readSelectedElement(selector);
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
