import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletionsUrl, generateText } from './service';

const config = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'secret',
  modelId: 'example-model',
};

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI Compatible 服务', () => {
  it('从 Base URL 构造 Chat Completions 地址', () => {
    expect(chatCompletionsUrl('https://example.com/v1/')).toBe('https://example.com/v1/chat/completions');
    expect(chatCompletionsUrl('https://example.com/v1/chat/completions')).toBe('https://example.com/v1/chat/completions');
  });

  it('发送请求并读取模型文本', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: ' 生成结果 ' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateText(config, '用户提示', { system: '系统提示', temperature: 0.2 })).resolves.toBe('生成结果');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/v1/chat/completions');
    expect(JSON.parse(request.body)).toMatchObject({
      model: 'example-model',
      messages: [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: '用户提示' },
      ],
      temperature: 0.2,
    });
  });

  it('把鉴权错误转换为可读提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })));
    await expect(generateText(config, 'hello')).rejects.toThrow('API Key 无效或没有调用权限');
  });
});
