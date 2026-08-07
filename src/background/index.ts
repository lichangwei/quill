import type { EnhanceRequest, EnhanceResponse, Settings } from '../types';
import { buildPrompt } from './prompt';

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return;
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
        let result: string;
        if (settings.provider === 'claude') {
          result = await callClaude(prompt, settings);
        } else {
          result = await callOpenAI(prompt, settings);
        }
        sendResponse({ result } as EnhanceResponse);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        sendResponse({ error: message } as EnhanceResponse);
      }
    })();
    return true; // 保持异步通道
  }
});
