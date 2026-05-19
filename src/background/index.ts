import type { EnhanceRequest, EnhanceResponse, Settings } from '../types';

const TEMPLATES: Record<string, string> = {
  polish: '请润色以下文字，使其更专业流畅，保持原意，只返回结果，不要任何解释：\n\n',
  translate: '请将以下文字翻译成{targetLang}，只返回翻译结果，不要任何解释：\n\n',
  shorten: '请将以下文字精简缩写，保留核心信息，只返回结果，不要任何解释：\n\n',
  expand: '请将以下文字扩写，使内容更丰富详细，只返回结果，不要任何解释：\n\n',
};

async function getSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { provider: 'openai', apiKey: '', model: 'gpt-4o', endpoint: '', targetLang: '中文' },
      (items) => resolve(items as unknown as Settings)
    );
  });
}

function buildPrompt(template: string, context: EnhanceRequest['context'], targetLang: string): string {
  const instruction = TEMPLATES[template].replace('{targetLang}', targetLang);
  return `页面：${context.pageTitle}\n字段：${context.fieldLabel}\n\n${instruction}${context.content}`;
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
        const prompt = buildPrompt(req.template, req.context, settings.targetLang);
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
