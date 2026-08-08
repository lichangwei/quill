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

  it('校验 OpenAI Compatible 必填字段', () => {
    expect(validateModelConfig({ name: '模型', baseUrl: 'invalid', apiKey: 'key', modelId: 'model' })).toBe('Base URL 格式不正确');
    expect(validateModelConfig({ name: '模型', baseUrl: 'https://example.com/v1', apiKey: 'key', modelId: 'model' })).toBeNull();
  });
});
