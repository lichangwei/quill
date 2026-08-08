import { QuillPanel } from '../panel/Panel';
import { buildEditorState, getActionGroups } from '../actions/storage';
import * as Types from '../types';

const BUTTON_ATTR = 'data-quill-btn';
const INPUT_SELECTOR = 'input, textarea';
const panel = new QuillPanel();

type TargetInput = HTMLInputElement | HTMLTextAreaElement;
let activeTarget: TargetInput | null = null;

function isValidInput(el: Element): el is TargetInput {
  if (el instanceof HTMLInputElement) {
    return el.type.toLowerCase() === 'text';
  }
  return el instanceof HTMLTextAreaElement;
}

function createButton(el: TargetInput): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.setAttribute(BUTTON_ATTR, 'true');
  btn.title = 'Quill AI 优化';
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
    activeTarget = el;
    const rect = el.getBoundingClientRect();
    void panel.showActions(el, rect);
  });

  document.body.appendChild(btn);
  return btn;
}

function positionButton(btn: HTMLButtonElement, el: TargetInput) {
  const rect = el.getBoundingClientRect();
  // 垂直居中于输入框右侧
  btn.style.top = `${rect.top + rect.height / 2 - 12}px`;
  btn.style.left = `${rect.right + 4}px`;
}

function attachToInput(el: TargetInput) {
  if (el.hasAttribute(BUTTON_ATTR)) return;
  el.setAttribute(BUTTON_ATTR, 'true');

  const btn = createButton(el);

  const show = () => {
    activeTarget = el;
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
  root.querySelectorAll<TargetInput>(INPUT_SELECTOR).forEach((el) => {
    if (isValidInput(el) && !el.hasAttribute(BUTTON_ATTR)) {
      attachToInput(el);
    }
  });
}

function getCurrentTarget(): TargetInput | null {
  if (document.activeElement && isValidInput(document.activeElement)) {
    return document.activeElement;
  }
  if (activeTarget?.isConnected) return activeTarget;
  return Array.from(document.querySelectorAll(INPUT_SELECTOR)).find(isValidInput) || null;
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message.type !== 'GET_CURRENT_EDITOR_STATE') return;
  const target = getCurrentTarget();
  if (!target) {
    sendResponse({ state: null });
    return;
  }
  void getActionGroups()
    .then((groups) => {
      const state: Types.EditorState = buildEditorState(groups, location.href, target);
      sendResponse({ state });
    })
    .catch((error: unknown) => {
      sendResponse({ error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

// 初始扫描
scanInputs();

// 监听 DOM 变化（SPA 路由切换、动态渲染）
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof Element) {
        if (isValidInput(node)) {
          attachToInput(node);
        } else {
          scanInputs(node);
        }
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
