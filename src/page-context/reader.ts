import { PageController, type BrowserState } from '@page-agent/page-controller';
import type { PageFieldRequest, PageFieldResponse } from '../types';
import { readLabeledField } from './dom-reader';

function requestPageField(payload: PageFieldRequest): Promise<PageFieldResponse> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'EXTRACT_PAGE_FIELD', payload }, (response?: PageFieldResponse) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || '通信错误'));
      } else if (!response) {
        reject(new Error('未收到页面字段读取结果'));
      } else {
        resolve(response);
      }
    });
  });
}

export async function readPageContent(description: string): Promise<string> {
  const localValue = readLabeledField(description);
  if (localValue) return localValue;

  const quillElements = Array.from(document.querySelectorAll('[data-quill-btn], #quill-panel'));
  const pageController = new PageController({
    viewportExpansion: -1,
    interactiveBlacklist: quillElements,
    // 仅使用 Page Agent 的 DOM 提取能力，不向用户展示交互编号和颜色标记。
    highlightOpacity: 0,
    highlightLabelOpacity: 0,
  });
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (args[0] !== 'Unable to access iframe:') originalWarn(...args);
  };
  try {
    const state: BrowserState = await pageController.getBrowserState();
    // getBrowserState() 会短暂注入高亮，读取完成后立即移除，避免覆盖页面内容。
    await pageController.cleanUpHighlights();
    const response = await requestPageField({
      description,
      pageTitle: state.title,
      pageUrl: state.url,
      pageContent: `${state.header}\n${state.content}\n${state.footer}`,
    });
    if (response.error) throw new Error(response.error);
    if (!response.result?.trim()) throw new Error(`未找到页面字段“${description}”`);
    return response.result.trim();
  } finally {
    console.warn = originalWarn;
    // Page Agent 会在页面中注入带编号的高亮节点；无论提取是否成功都必须移除。
    await pageController.cleanUpHighlights().catch((error) => {
      console.warn('[Quill] 清理 Page Agent 高亮失败:', error);
    });
    pageController.dispose();
  }
}
