import type { EnhanceResponse } from '../../types';

export interface PageChatMountOptions { tabId: number; onBack: () => void; }

function getPageContext(tabId: number): Promise<{ pageText?: string; selectedText?: string }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_CONTEXT' }, (response) => {
      const message = chrome.runtime.lastError?.message;
      if (!message) { resolve(response || {}); return; }
      reject(new Error(message.includes('Receiving end does not exist')
        ? '当前页面尚未加载嘴替脚本，请刷新页面后再试。chrome:// 等浏览器内部页面不支持与页面对话。'
        : message));
    });
  });
}

export function mountPageChat(container: HTMLElement, options: PageChatMountOptions): void {
  container.classList.add('page-chat-mode');
  let messages: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  container.innerHTML = `<section class="page-chat"><div class="page-chat-header"><button type="button" class="page-chat-back">返回动作</button><h2>与页面对话</h2><button type="button" class="page-chat-clear">清空</button></div><div class="page-chat-messages" aria-live="polite"><p class="page-chat-empty">围绕当前页面提问</p></div><form class="page-chat-form"><textarea aria-label="输入问题" placeholder="询问当前页面内容..." required></textarea><button type="submit" class="primary">发送</button></form></section>`;
  const messagesNode = container.querySelector<HTMLElement>('.page-chat-messages')!;
  const form = container.querySelector<HTMLFormElement>('.page-chat-form')!;
  const input = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const render = () => { messagesNode.replaceChildren(...messages.map((m) => { const node = document.createElement('div'); node.className = `page-chat-message ${m.role}`; node.textContent = m.text; return node; })); messagesNode.scrollTop = messagesNode.scrollHeight; };
  container.querySelector('.page-chat-back')!.addEventListener('click', options.onBack);
  container.querySelector('.page-chat-clear')!.addEventListener('click', () => { messages = []; render(); });
  form.addEventListener('submit', (event) => { event.preventDefault(); const question = input.value.trim(); if (!question) return; input.value = ''; messages.push({ role: 'user', text: question }); render(); void (async () => { const context = await getPageContext(options.tabId); const response = await new Promise<EnhanceResponse>((resolve, reject) => chrome.runtime.sendMessage({ type: 'ENHANCE_TEXT', payload: { prompt: `${question}\n\n请基于页面内容回答，不要编造页面未提供的信息。\n页面内容：{content}`, context: { pageTitle: '当前页面', fieldLabel: '当前页面', content: `${context.selectedText || ''}\n${context.pageText || ''}` } } }, (result) => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(result || {}))); messages.push({ role: 'assistant', text: response.result || response.error || '未能获得回答' }); render(); })().catch((error) => { messages.push({ role: 'assistant', text: error instanceof Error ? error.message : String(error) }); render(); }); });
}
