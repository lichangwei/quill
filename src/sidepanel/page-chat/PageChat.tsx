import type { EnhanceResponse } from '../../types';

export interface PageChatMountOptions { tabId: number; onBack: () => void; }

function renderMarkdown(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

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
  container.innerHTML = `<section class="page-chat"><div class="page-chat-header"><button type="button" class="page-chat-back">返回动作</button><h2>与页面对话</h2><button type="button" class="page-chat-clear">清空</button></div><div class="page-chat-messages" aria-live="polite"><div class="page-chat-prompt"><p class="page-chat-empty">您可能会问</p><div class="page-chat-suggestions" hidden></div></div></div><form class="page-chat-form"><textarea aria-label="输入问题" placeholder="询问当前页面内容..." required></textarea><button type="submit" class="primary">发送</button></form></section>`;
  const messagesNode = container.querySelector<HTMLElement>('.page-chat-messages')!;
  const form = container.querySelector<HTMLFormElement>('.page-chat-form')!;
  const input = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const suggestions = container.querySelector<HTMLElement>('.page-chat-suggestions')!;
  const prompt = container.querySelector<HTMLElement>('.page-chat-prompt')!;
  const render = () => { const promptNode = messagesNode.querySelector('.page-chat-prompt'); messagesNode.replaceChildren(...messages.map((m) => { const node = document.createElement('div'); node.className = `page-chat-message ${m.role}`; if (m.role === 'assistant') node.innerHTML = renderMarkdown(m.text); else node.textContent = m.text; return node; }), promptNode || document.createElement('div')); messagesNode.scrollTop = messagesNode.scrollHeight; };
  container.querySelector('.page-chat-back')!.addEventListener('click', options.onBack);
  container.querySelector('.page-chat-clear')!.addEventListener('click', () => { messages = []; render(); });
  const sendQuestion = (question: string) => { prompt.hidden = true; input.value = question; form.requestSubmit(); };
  form.addEventListener('submit', () => { prompt.hidden = true; });
  form.addEventListener('submit', (event) => { event.preventDefault(); const question = input.value.trim(); if (!question) return; input.value = ''; messages.push({ role: 'user', text: question }); render(); void (async () => { const context = await getPageContext(options.tabId); const response = await new Promise<EnhanceResponse>((resolve, reject) => chrome.runtime.sendMessage({ type: 'ENHANCE_TEXT', payload: { prompt: `${question}\n\n请基于页面内容回答，不要编造页面未提供的信息。\n页面内容：{content}`, context: { pageTitle: '当前页面', fieldLabel: '当前页面', content: `${context.selectedText || ''}\n${context.pageText || ''}` } } }, (result) => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(result || {}))); messages.push({ role: 'assistant', text: response.result || response.error || '未能获得回答' }); render(); })().catch((error) => { messages.push({ role: 'assistant', text: error instanceof Error ? error.message : String(error) }); render(); }); });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
  const resizeInput = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 72)}px`; input.style.overflowY = input.scrollHeight > 72 ? 'auto' : 'hidden'; };
  input.addEventListener('input', resizeInput); resizeInput();
  const renderSuggestions = (questions: string[]) => {
    suggestions.replaceChildren();
    ['总结全文', ...questions].forEach((question) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = question; button.addEventListener('click', () => sendQuestion(question)); suggestions.append(button); });
    suggestions.hidden = false;
  };
  // 固定选项必须立即展示，即使页面脚本尚未就绪。
  renderSuggestions([]);
  void (async () => {
    try {
      const context = await getPageContext(options.tabId);
      const response = await new Promise<EnhanceResponse>((resolve, reject) => chrome.runtime.sendMessage({ type: 'ENHANCE_TEXT', payload: { prompt: '请根据页面内容提出三个最可能的问题。每个问题控制在12字以内，只输出三行问题文本，不要编号、不要解释。\n页面内容：{content}', context: { pageTitle: '当前页面', fieldLabel: '当前页面', content: `${context.selectedText || ''}\n${context.pageText || ''}` } } }, (result) => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(result || {})));
      const questions = (response.result || '').split(/\n|(?<=[。！？?])\s+/).map((line) => line.replace(/^[-*\d.、）)]+\s*/, '').trim()).filter(Boolean).map((line) => line.length > 16 ? `${line.slice(0, 16)}…` : line).slice(0, 3);
      renderSuggestions(questions);
    } catch { /* 页面上下文不可用时仍可手动提问 */ }
  })();
}
