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
  });
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (args[0] !== 'Unable to access iframe:') originalWarn(...args);
  };
  let state: BrowserState;
  try {
    state = await pageController.getBrowserState();
  } finally {
    console.warn = originalWarn;
  }
  const response = await requestPageField({
    description,
    pageTitle: state.title,
    pageUrl: state.url,
    pageContent: `${state.header}\n${state.content}\n${state.footer}`,
  });
  if (response.error) throw new Error(response.error);
  if (!response.result?.trim()) throw new Error(`未找到页面字段“${description}”`);
  return response.result.trim();
}
