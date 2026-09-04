import * as Types from '../types';
import { validateModelConfig } from '../settings/storage';

export interface GenerateOptions {
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

/** Anthropic 的 max_tokens 必填；任何格式未显式指定输出上限时的兜底值。 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

const ANTHROPIC_VERSION = '2023-06-01';

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ModelRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeFormat(format: unknown): Types.ModelFormat {
  return format === 'openai-responses' || format === 'anthropic' ? format : 'openai-chat';
}

function appendPath(baseUrl: string, suffix: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return appendPath(baseUrl, '/chat/completions');
}

export function buildEndpoint(format: Types.ModelFormat, baseUrl: string): string {
  switch (format) {
    case 'openai-responses':
      return appendPath(baseUrl, '/responses');
    case 'anthropic':
      return appendPath(baseUrl, '/messages');
    default:
      return appendPath(baseUrl, '/chat/completions');
  }
}

export function buildRequest(config: Types.ModelConfig, prompt: string, options: GenerateOptions): ModelRequest {
  const format = normalizeFormat(config.format);
  const url = buildEndpoint(format, config.baseUrl);
  const maxTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  if (format === 'anthropic') {
    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: config.modelId,
        system: options.system,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature,
        max_tokens: maxTokens,
      }),
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };

  if (format === 'openai-responses') {
    return {
      url,
      headers,
      body: JSON.stringify({
        model: config.modelId,
        instructions: options.system,
        input: prompt,
        temperature: options.temperature,
        max_output_tokens: options.maxOutputTokens,
      }),
    };
  }

  const messages: ChatMessage[] = [];
  if (options.system) messages.push({ role: 'system', content: options.system });
  messages.push({ role: 'user', content: prompt });
  return {
    url,
    headers,
    body: JSON.stringify({
      model: config.modelId,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens,
    }),
  };
}

function parseChatResponse(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) throw new Error('模型响应格式不正确');
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string') {
    throw new Error('模型响应中没有文本内容');
  }
  return choice.message.content.trim();
}

function collectText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
}

function parseResponsesResponse(value: unknown): string {
  if (!isRecord(value)) throw new Error('模型响应格式不正确');
  if (typeof value.output_text === 'string' && value.output_text.trim()) return value.output_text.trim();
  if (Array.isArray(value.output)) {
    const text = value.output
      .map((item) => (isRecord(item) ? collectText(item.content) : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  throw new Error('模型响应中没有文本内容');
}

function parseAnthropicResponse(value: unknown): string {
  if (!isRecord(value)) throw new Error('模型响应格式不正确');
  const text = collectText(value.content).trim();
  if (!text) throw new Error('模型响应中没有文本内容');
  return text;
}

export function parseResponse(format: Types.ModelFormat, value: unknown): string {
  switch (format) {
    case 'openai-responses':
      return parseResponsesResponse(value);
    case 'anthropic':
      return parseAnthropicResponse(value);
    default:
      return parseChatResponse(value);
  }
}

function errorMessage(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API Key 无效或没有调用权限';
  if (status === 404) return 'Base URL 或模型 ID 不正确';
  if (status === 429) return '模型服务请求过于频繁，请稍后重试';
  return `模型服务请求失败（${status}）：${body.slice(0, 300)}`;
}

export async function generateText(config: Types.ModelConfig, prompt: string, options: GenerateOptions = {}): Promise<string> {
  const validationError = validateModelConfig(config);
  if (validationError) throw new Error(validationError);
  const request = buildRequest(config, prompt, options);
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: options.abortSignal,
  });
  if (!response.ok) throw new Error(errorMessage(response.status, await response.text()));
  return parseResponse(normalizeFormat(config.format), await response.json());
}

export function modelsUrl(baseUrl: string): string {
  return appendPath(baseUrl, '/models');
}

function parseModelList(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data
    .filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.id === 'string')
    .map((item) => item.id as string);
}

/** 拉取该格式下可选的模型 ID 列表；端点不可用时抛错，由调用方兜底。 */
export async function listModels(config: Omit<Types.ModelConfig, 'modelId'>, abortSignal?: AbortSignal): Promise<string[]> {
  const format = normalizeFormat(config.format);
  const headers: Record<string, string> = format === 'anthropic'
    ? { 'x-api-key': config.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' }
    : { Authorization: `Bearer ${config.apiKey}` };
  const response = await fetch(modelsUrl(config.baseUrl), { method: 'GET', headers, signal: abortSignal });
  if (!response.ok) throw new Error(errorMessage(response.status, await response.text()));
  return parseModelList(await response.json());
}

export interface DetectFormatResult {
  format?: Types.ModelFormat;
  models?: string[];
  error?: string;
}

interface DetectInput {
  baseUrl: string;
  apiKey: string;
}

/** 用一个候选模型探测某 OpenAI 系格式是否可用。 */
async function probeOpenAiFormat(format: 'openai-chat' | 'openai-responses', input: DetectInput, model: string): Promise<boolean> {
  try {
    await generateText({ ...input, format, modelId: model }, 'hi', { maxOutputTokens: 16, temperature: 0 });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('API Key 无效')) throw error; // 鉴权失败：格式对了但凭据无效，向上抛出。
    return false;
  }
}

/**
 * 通过 GET /models 探测接口格式并拉取可选模型：
 * - Bearer 认证成功 → OpenAI 系，再用首个模型区分 Chat / Responses；
 * - x-api-key 认证成功 → Anthropic。
 * 端点不支持 /models 时无法自动识别，回报错误由调用方引导手动选择。
 */
export async function detectFormat(input: DetectInput): Promise<DetectFormatResult> {
  const openaiModels = await listModels({ format: 'openai-chat', baseUrl: input.baseUrl, apiKey: input.apiKey }).catch(() => null);
  if (openaiModels && openaiModels.length > 0) {
    try {
      if (await probeOpenAiFormat('openai-chat', input, openaiModels[0])) return { format: 'openai-chat', models: openaiModels };
      if (await probeOpenAiFormat('openai-responses', input, openaiModels[0])) return { format: 'openai-responses', models: openaiModels };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    // 两种 OpenAI 格式都未确认，默认按 Chat Completions 返回，仍给出模型列表供选择。
    return { format: 'openai-chat', models: openaiModels };
  }

  const anthropicModels = await listModels({ format: 'anthropic', baseUrl: input.baseUrl, apiKey: input.apiKey }).catch(() => null);
  if (anthropicModels && anthropicModels.length > 0) return { format: 'anthropic', models: anthropicModels };

  return { error: '未能自动识别接口格式，请确认 Base URL 与 API Key，或手动选择接口格式' };
}

export async function testConnection(config: Types.ModelConfig): Promise<ConnectionTestResult> {
  try {
    const start = performance.now();
    await generateText(config, 'hello', { maxOutputTokens: 16, temperature: 0 });
    return { success: true, latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
