import type { EditorState, EnhanceRequest, EnhanceResponse, PageFieldRequest, Settings } from '../types';
import { PAGE_FIELD_NOT_FOUND, buildPageFieldPrompt, buildPrompt } from './prompt';

if (chrome.sidePanel) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.error('[Quill] 配置工具栏打开侧边栏失败:', error);
  });
}

const LEGACY_POLISH_PROMPT = '请润色以下文字，使其更专业流畅，保持原意，只返回结果，不要任何解释：\n\n{content}';

async function getSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { provider: 'openai', apiKey: '', model: 'gpt-4o', endpoint: '' },
      (items) => resolve(items as unknown as Settings)
    );
  });
}

async function callOpenAI(prompt: string, settings: Settings): Promise<string> {
  const endpoint = settings.endpoint || 'https://api.openai.com/v1/chat/completions';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function callClaude(prompt: string, settings: Settings): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: settings.model || 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text.trim();
}

async function callModel(prompt: string, settings: Settings): Promise<string> {
  return settings.provider === 'claude'
    ? callClaude(prompt, settings)
    : callOpenAI(prompt, settings);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (msg.type === 'OPEN_EDITOR_SIDE_PANEL') {
    const state = msg.payload as EditorState;
    const tabId = _sender.tab?.id;
    (async () => {
      try {
        if (!chrome.sidePanel || tabId === undefined) throw new Error('无法获取当前页面标签');
        await chrome.storage.session.set({ editorState: state });
        await chrome.sidePanel.setOptions({
          tabId,
          path: 'src/sidepanel/sidepanel.html',
          enabled: true,
        });
        sendResponse({ requiresToolbarClick: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Quill] 打开 Chrome 侧边栏失败: ${message}`);
        sendResponse({ error: message });
      }
    })();
    return true;
  }
  if (msg.type === 'ENHANCE_TEXT') {
    const req = msg.payload as EnhanceRequest;
    (async () => {
      try {
        const settings = await getSettings();
        if (!settings.apiKey) {
          sendResponse({ error: '请先在设置页配置 API Key' } as EnhanceResponse);
          return;
        }
        const legacyTemplate = (req as EnhanceRequest & { template?: string }).template;
        const actionPrompt = typeof req.prompt === 'string'
          ? req.prompt
          : legacyTemplate === 'polish'
            ? LEGACY_POLISH_PROMPT
            : null;
        if (!actionPrompt || !req.context) {
          sendResponse({ error: '扩展已更新，请刷新当前页面后重试' } as EnhanceResponse);
          return;
        }
        const prompt = buildPrompt(actionPrompt, req.context);
        console.info(`[Quill] 最终生成提示词\n${prompt}`);
        const result = await callModel(prompt, settings);
        sendResponse({ result } as EnhanceResponse);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        sendResponse({ error: message } as EnhanceResponse);
      }
    })();
    return true; // 保持异步通道
  }
  if (msg.type === 'EXTRACT_PAGE_FIELD') {
    const req = msg.payload as PageFieldRequest;
    (async () => {
      try {
        const settings = await getSettings();
        if (!settings.apiKey) {
          sendResponse({ error: '请先在设置页配置 API Key' } as EnhanceResponse);
          return;
        }
        if (!req?.description || !req.pageContent) {
          sendResponse({ error: '页面字段读取参数不完整' } as EnhanceResponse);
          return;
        }
        const extractionPrompt = buildPageFieldPrompt(req);
        console.info(`[Quill] 页面字段提取提示词\n${extractionPrompt}`);
        const result = await callModel(extractionPrompt, settings);
        if (!result || result.includes(PAGE_FIELD_NOT_FOUND)) {
          sendResponse({ error: `未找到页面字段“${req.description}”` } as EnhanceResponse);
          return;
        }
        sendResponse({ result } as EnhanceResponse);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        sendResponse({ error: message } as EnhanceResponse);
      }
    })();
    return true;
  }
});
