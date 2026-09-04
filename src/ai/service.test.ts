import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEndpoint, chatCompletionsUrl, detectFormat, generateText, listModels } from './service';
import type { ModelConfig } from '../types';

const config: ModelConfig = {
  format: 'openai-chat',
  baseUrl: 'https://example.com/v1',
  apiKey: 'secret',
  modelId: 'example-model',
};

afterEach(() => vi.unstubAllGlobals());

describe('buildEndpoint 按格式补全端点', () => {
  it('Chat Completions 补全并幂等', () => {
    expect(buildEndpoint('openai-chat', 'https://example.com/v1/')).toBe('https://example.com/v1/chat/completions');
    expect(buildEndpoint('openai-chat', 'https://example.com/v1/chat/completions')).toBe('https://example.com/v1/chat/completions');
    expect(chatCompletionsUrl('https://example.com/v1')).toBe('https://example.com/v1/chat/completions');
  });

  it('Responses 与 Anthropic 补全并幂等', () => {
    expect(buildEndpoint('openai-responses', 'https://example.com/v1')).toBe('https://example.com/v1/responses');
    expect(buildEndpoint('openai-responses', 'https://example.com/v1/responses')).toBe('https://example.com/v1/responses');
    expect(buildEndpoint('anthropic', 'https://example.com/v1')).toBe('https://example.com/v1/messages');
    expect(buildEndpoint('anthropic', 'https://example.com/v1/messages')).toBe('https://example.com/v1/messages');
  });
});

describe('Chat Completions 格式', () => {
  it('发送请求并读取模型文本', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: ' 生成结果 ' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateText(config, '用户提示', { system: '系统提示', temperature: 0.2 })).resolves.toBe('生成结果');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer secret');
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

describe('Responses API 格式', () => {
  it('发送 input/instructions 并从 output_text 取值', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: ' Responses 结果 ',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const responsesConfig: ModelConfig = { ...config, format: 'openai-responses' };
    await expect(generateText(responsesConfig, '用户提示', { system: '系统提示', maxOutputTokens: 128 })).resolves.toBe('Responses 结果');
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/v1/responses');
    expect(request.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(request.body)).toMatchObject({
      model: 'example-model',
      instructions: '系统提示',
      input: '用户提示',
      max_output_tokens: 128,
    });
  });

  it('output_text 缺失时回退遍历 output 数组', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ content: [{ type: 'text', text: '段落结果' }] }],
    }), { status: 200 })));
    const responsesConfig: ModelConfig = { ...config, format: 'openai-responses' };
    await expect(generateText(responsesConfig, 'hi')).resolves.toBe('段落结果');
  });
});

describe('listModels 拉取模型列表', () => {
  it('OpenAI 格式用 Bearer 并解析 data[].id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'gpt-a' }, { id: 'gpt-b' }, { foo: 'no-id' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listModels({ format: 'openai-chat', baseUrl: 'https://example.com/v1', apiKey: 'secret' })).resolves.toEqual(['gpt-a', 'gpt-b']);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/v1/models');
    expect(request.method).toBe('GET');
    expect(request.headers.Authorization).toBe('Bearer secret');
  });

  it('Anthropic 格式用 x-api-key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'claude-x', display_name: 'Claude X' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listModels({ format: 'anthropic', baseUrl: 'https://example.com/v1', apiKey: 'secret' })).resolves.toEqual(['claude-x']);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/v1/models');
    expect(request.headers['x-api-key']).toBe('secret');
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
  });
});

describe('detectFormat 自动检测', () => {
  it('Bearer 拉到模型且 chat 探测成功 → openai-chat', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-a' }, { id: 'gpt-b' }] }), { status: 200 });
      if (url.endsWith('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(detectFormat({ baseUrl: 'https://example.com/v1', apiKey: 'secret' }))
      .resolves.toEqual({ format: 'openai-chat', models: ['gpt-a', 'gpt-b'] });
  });

  it('chat 探测 404 但 responses 成功 → openai-responses', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-a' }] }), { status: 200 });
      if (url.endsWith('/responses')) return new Response(JSON.stringify({ output_text: 'ok' }), { status: 200 });
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(detectFormat({ baseUrl: 'https://example.com/v1', apiKey: 'secret' }))
      .resolves.toEqual({ format: 'openai-responses', models: ['gpt-a'] });
  });

  it('Bearer /models 失败但 x-api-key 成功 → anthropic', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      if (url.endsWith('/models') && headers['x-api-key']) return new Response(JSON.stringify({ data: [{ id: 'claude-x' }] }), { status: 200 });
      return new Response('unauthorized', { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(detectFormat({ baseUrl: 'https://example.com/v1', apiKey: 'secret' }))
      .resolves.toEqual({ format: 'anthropic', models: ['claude-x'] });
  });

  it('三种格式都拉不到模型 → 返回错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
    const result = await detectFormat({ baseUrl: 'https://example.com/v1', apiKey: 'secret' });
    expect(result.format).toBeUndefined();
    expect(result.error).toContain('未能自动识别');
  });
});

describe('Anthropic Messages 格式', () => {
  it('发送 x-api-key 与 system，并从 content 取文本', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: ' Claude 结果 ' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const anthropicConfig: ModelConfig = { ...config, format: 'anthropic' };
    await expect(generateText(anthropicConfig, '用户提示', { system: '系统提示', temperature: 0.3 })).resolves.toBe('Claude 结果');
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/v1/messages');
    expect(request.headers['x-api-key']).toBe('secret');
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
    expect(request.headers.Authorization).toBeUndefined();
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({
      model: 'example-model',
      system: '系统提示',
      messages: [{ role: 'user', content: '用户提示' }],
      temperature: 0.3,
    });
    expect(typeof body.max_tokens).toBe('number');
    expect(body.max_tokens).toBeGreaterThan(0);
  });
});
