import { describe, expect, it } from 'vitest';
import { normalizeModelState, validateModelConfig } from './storage';

describe('模型配置规范化', () => {
  it('过滤无效模型并修复默认和当前模型', () => {
    const state = normalizeModelState({
      models: [
        { id: 'valid', name: '工作模型', baseUrl: 'https://example.com/v1', apiKey: 'key', modelId: 'model', enabled: true },
        { id: 'invalid', name: '', baseUrl: '', apiKey: '', modelId: '', enabled: true },
      ],
      defaultModelId: 'missing',
      activeModelId: 'missing',
    });
    expect(state.models).toHaveLength(1);
    expect(state.defaultModelId).toBe('valid');
    expect(state.activeModelId).toBe('valid');
  });

  it('把缺失或非法的接口格式回退为 openai-chat', () => {
    const state = normalizeModelState({
      models: [
        { id: 'legacy', name: '旧模型', baseUrl: 'https://example.com/v1', apiKey: 'key', modelId: 'model', enabled: true },
        { id: 'weird', name: '异常格式', format: 'unknown', baseUrl: 'https://example.com/v1', apiKey: 'key', modelId: 'model', enabled: true },
      ],
      defaultModelId: 'legacy',
      activeModelId: 'legacy',
    });
    expect(state.models).toHaveLength(2);
    expect(state.models.map((model) => model.format)).toEqual(['openai-chat', 'openai-chat']);
  });

  it('校验必填字段', () => {
    expect(validateModelConfig({ name: '模型', format: 'openai-chat', baseUrl: 'invalid', apiKey: 'key', modelId: 'model' })).toBe('Base URL 格式不正确');
    expect(validateModelConfig({ name: '模型', format: 'openai-chat', baseUrl: 'https://example.com/v1', apiKey: 'key', modelId: 'model' })).toBeNull();
    expect(validateModelConfig({ name: '模型', format: 'anthropic', baseUrl: 'https://example.com', apiKey: 'key', modelId: 'model' })).toBeNull();
  });
});
