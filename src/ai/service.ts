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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function responseText(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) throw new Error('模型响应格式不正确');
  const choice = value.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string') {
    throw new Error('模型响应中没有文本内容');
  }
  return choice.message.content.trim();
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
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (options.system) messages.push({ role: 'system', content: options.system });
  messages.push({ role: 'user', content: prompt });
  const response = await fetch(chatCompletionsUrl(config.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens,
    }),
    signal: options.abortSignal,
  });
  if (!response.ok) throw new Error(errorMessage(response.status, await response.text()));
  return responseText(await response.json());
}

export async function testConnection(config: Types.ModelConfig): Promise<ConnectionTestResult> {
  try {
    const start = performance.now();
    await generateText(config, 'hello', { maxOutputTokens: 1, temperature: 0 });
    return { success: true, latencyMs: Math.round(performance.now() - start) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
