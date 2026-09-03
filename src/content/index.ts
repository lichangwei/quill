import { QuillPanel } from '../panel/Panel';
import { isContentEditableTarget, type EditableTarget } from './filler';
import { generateElementTarget, targetToSelector } from '../actions/storage';
import { readSelectedElement } from '../page-context/reader';
import { captureFingerprint } from '../page-context/fingerprint';
import { createDomScanScheduler } from './dom-scan-scheduler';
import type { ElementPickerResult } from '../types';
import { getDisableState } from '../settings/disable-rules';

const BUTTON_ATTR = 'data-quill-btn';
const PANEL_ID = 'quill-panel';
const panel = new QuillPanel();
// 不要在宿主页面的输入控件上写入标记属性：React/Next SSR 页面可能在
// hydration 前被 content script 扫描，额外属性会直接造成 hydration mismatch。
const attachedInputs = new WeakSet<TargetInput>();

type TargetInput = EditableTarget;

function isValidInput(el: Element): el is TargetInput {
  if (el instanceof HTMLInputElement) {
    const type = el.type.toLowerCase();
    return ['text', 'search', 'email', 'url', 'tel', ''].includes(type);
  }
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && isContentEditableTarget(el));
}

function createButton(el: TargetInput): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.setAttribute(BUTTON_ATTR, 'true');
  btn.title = '嘴替 AI 优化';
  btn.textContent = '✦';

  Object.assign(btn.style, {
    position: 'fixed',
    zIndex: '2147483646',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    border: 'none',
    background: '#6c47ff',
    color: '#fff',
    fontSize: '12px',
    cursor: 'pointer',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0',
    lineHeight: '1',
    boxShadow: '0 2px 8px rgba(108,71,255,0.4)',
    transition: 'opacity 0.15s',
  });

  btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });

  btn.addEventListener('mousedown', (e) => {
    e.preventDefault(); // 防止输入框失焦
    e.stopPropagation();
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    void panel.showActions(el, rect);
  });

  document.body.appendChild(btn);
  return btn;
}

function positionButton(btn: HTMLButtonElement, el: TargetInput) {
  const rect = el.getBoundingClientRect();
  const isMultiline = el instanceof HTMLTextAreaElement || isContentEditableTarget(el);
  // 多行编辑区域固定在右上角，单行输入框保持垂直居中。
  btn.style.top = `${isMultiline ? rect.top + 4 : rect.top + rect.height / 2 - 12}px`;
  btn.style.left = `${rect.right + 4}px`;
}

function attachToInput(el: TargetInput) {
  if (attachedInputs.has(el)) return;
  attachedInputs.add(el);

  const btn = createButton(el);

  const show = () => {
    positionButton(btn, el);
    btn.style.display = 'flex';
  };

  const hide = () => {
    // 延迟隐藏，避免点击按钮时先触发 blur
    setTimeout(() => {
      if (document.activeElement !== el) {
        btn.style.display = 'none';
      }
    }, 150);
  };

  const reposition = () => {
    if (btn.style.display !== 'none') {
      positionButton(btn, el);
    }
  };

  el.addEventListener('focus', show);
  el.addEventListener('blur', hide);
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition, { passive: true });
}

function scanInputs(root: Document | Element = document) {
  const selector = 'input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input:not([type]), textarea, [contenteditable]:not([contenteditable="false"])';
  root.querySelectorAll<TargetInput>(selector).forEach((el) => {
    if (!attachedInputs.has(el)) {
      attachToInput(el);
    }
  });
}

// 豆包等 SPA 会在短时间内产生大量 DOM 变更。将同一帧内的扫描合并，
// 避免 MutationObserver 为每个新增节点重复遍历子树。
const scheduleScan = createDomScanScheduler(scanInputs);

async function start(): Promise<void> {
  const state = await getDisableState(location.href);
  if (state.page || state.site) return;
  scanInputs();
  const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {
        if (node.id === PANEL_ID || node.hasAttribute(BUTTON_ATTR) || node.closest(`#${PANEL_ID}`)) continue;
        if (isValidInput(node)) {
          attachToInput(node);
        } else {
          scheduleScan(node);
        }
      }
    }
  }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
void start();

let cancelActivePicker: (() => void) | null = null;
let confirmActivePicker: (() => void) | null = null;

function pickerElementName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;
  if (element.id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`);
    const labelText = label?.textContent?.trim();
    if (labelText) return labelText;
  }
  const closestLabel = element.closest('label')?.textContent?.trim();
  if (closestLabel) return closestLabel;
  const formItem = element.closest('.el-form-item, .ant-form-item, .form-item, [class*="form-item"]');
  const formItemLabel = formItem?.querySelector('label, .el-form-item__label, .ant-form-item-label')?.textContent?.trim();
  if (formItemLabel) return formItemLabel.replace(/[：:*]\s*$/, '').trim();
  const placeholder = element.getAttribute('placeholder')?.trim();
  if (placeholder) return placeholder;
  const name = element.getAttribute('name')?.trim();
  if (name) return name;
  const heading = element.querySelector('h1, h2, h3, legend')?.textContent?.trim();
  if (heading) return heading;
  return element.tagName.toLowerCase();
}

function pickerElementValue(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value.trim();
  }
  if (element instanceof HTMLIFrameElement) {
    try {
      return (element.contentDocument?.body.innerText || '').trim();
    } catch {
      return '';
    }
  }
  if (element instanceof HTMLElement) return (element.innerText || element.textContent || '').trim();
  return (element.textContent || '').trim();
}

function pickerTargetAt(event: MouseEvent): Element | null {
  const editableSelector = 'input:not([type="hidden"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
  const eventTarget = event.composedPath().find((node): node is Element => node instanceof Element);
  const editableTarget = eventTarget?.closest(editableSelector);
  if (editableTarget) return editableTarget;

  // 部分组件库会在真实输入框上方覆盖包装节点，优先选择指针下方的实际编辑控件。
  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    if (element.matches(editableSelector)) return element;
    const nestedEditable = element.querySelector(editableSelector);
    if (nestedEditable) {
      const rect = nestedEditable.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom) {
        return nestedEditable;
      }
    }
  }
  return eventTarget || null;
}

function pageSelectorFor(element: Element): string {
  const parts: string[] = [];
  let current = element;
  while (current.getRootNode() instanceof ShadowRoot) {
    parts.unshift(targetToSelector(generateElementTarget(current)));
    current = (current.getRootNode() as ShadowRoot).host;
  }
  const selector = targetToSelector(generateElementTarget(current));
  return parts.length ? [selector, ...parts].join(' >>> ') : selector;
}

function startElementPicker(): Promise<ElementPickerResult> {
  cancelActivePicker?.();
  return new Promise((resolve, reject) => {
    const highlight = document.createElement('div');
    const tooltip = document.createElement('div');
    const pickerStyle = document.createElement('style');
    pickerStyle.textContent = '* { cursor: crosshair !important; }';
    pickerStyle.setAttribute('data-quill-picker', 'true');
    highlight.setAttribute('data-quill-picker', 'true');
    tooltip.setAttribute('data-quill-picker', 'true');
    Object.assign(highlight.style, {
      position: 'fixed',
      zIndex: '2147483645',
      display: 'none',
      pointerEvents: 'none',
      border: '2px solid #1677ff',
      background: 'rgba(22, 119, 255, 0.12)',
      boxSizing: 'border-box',
    });
    Object.assign(tooltip.style, {
      position: 'fixed',
      zIndex: '2147483646',
      display: 'none',
      maxWidth: 'min(420px, calc(100vw - 16px))',
      padding: '5px 8px',
      pointerEvents: 'none',
      color: '#fff',
      background: '#1677ff',
      borderRadius: '4px',
      font: '12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    document.documentElement.append(pickerStyle, highlight, tooltip);

    let hovered: Element | null = null;
    let settled = false;

    const cleanup = () => {
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      highlight.remove();
      tooltip.remove();
      pickerStyle.remove();
      if (cancelActivePicker === cancel) cancelActivePicker = null;
      if (confirmActivePicker) confirmActivePicker = null;
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('已取消选择页面元素'));
    };
    const onMouseMove = (event: MouseEvent) => {
      const target = pickerTargetAt(event);
      if (!target || target.closest('[data-quill-picker], button[data-quill-btn], #quill-panel')) return;
      hovered = target;
      const rect = target.getBoundingClientRect();
      Object.assign(highlight.style, {
        display: 'block',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      const value = pickerElementValue(target);
      tooltip.textContent = value || '（空）';
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - tooltip.offsetWidth - 8))}px`;
      tooltip.style.top = `${rect.top > 34 ? rect.top - 30 : Math.min(innerHeight - 30, rect.bottom + 4)}px`;
    };
    const confirmHovered = (event?: Event) => {
      if (!hovered) return;
      event?.preventDefault();
      event?.stopImmediatePropagation();
      const selector = pageSelectorFor(hovered);
      const fallback = captureFingerprint(hovered);
      const result: ElementPickerResult = {
        name: pickerElementName(hovered),
        selector,
        tagName: hovered.tagName.toLowerCase(),
        ...(fallback ? { fallback } : {}),
      };
      settled = true;
      cleanup();
      resolve(result);
    };
    const onClick = (event: MouseEvent) => confirmHovered(event);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      } else if (event.key === 'Enter') {
        confirmHovered(event);
      } else if (event.key === ' ') {
        event.preventDefault();
        confirmHovered(event);
      }
    };

    cancelActivePicker = cancel;
    confirmActivePicker = () => confirmHovered();
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CONTEXT') {
    const selectedText = window.getSelection()?.toString().trim() || '';
    const clone = document.body?.cloneNode(true) as HTMLElement | undefined;
    clone?.querySelectorAll('script,style,noscript,template,input[type="password"]')?.forEach((node) => node.remove());
    sendResponse({ pageText: (clone?.innerText || document.body?.innerText || '').trim().slice(0, 50000), selectedText });
    return;
  }
  if (message.type === 'CONFIRM_ELEMENT_PICKER') {
    const active = !!confirmActivePicker;
    confirmActivePicker?.();
    sendResponse({ ok: active });
    return;
  }
  if (message.type === 'CANCEL_ELEMENT_PICKER') {
    const active = !!cancelActivePicker;
    cancelActivePicker?.();
    sendResponse({ ok: active });
    return;
  }
  if (message.type === 'READ_SELECTED_ELEMENT') {
    const selector = typeof message.selector === 'string' ? message.selector : '';
    const fallback = message.fallback && typeof message.fallback === 'object' ? message.fallback : undefined;
    const result = selector ? readSelectedElement(selector, fallback) : { found: false, value: '' };
    sendResponse(result);
    return;
  }
  if (message.type !== 'START_ELEMENT_PICKER') return;
  startElementPicker()
    .then((result) => sendResponse({ result }))
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});
