import { describe, expect, it } from 'vitest';
import { BUILT_IN_STYLES, normalizeModelState, normalizeStyleState, validateModelConfig } from './storage';

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

describe('风格配置规范化', () => {
  it('保留内置风格并恢复失效的默认和当前风格', () => {
    const state = normalizeStyleState({
      styles: [{ id: 'custom-1', name: '自定义', description: '自定义要求', builtIn: false }],
      defaultStyleId: 'missing',
      activeStyleId: 'custom-1',
    });
    expect(state.styles.slice(0, BUILT_IN_STYLES.length)).toEqual(BUILT_IN_STYLES);
    expect(state.defaultStyleId).toBe('formal');
    expect(state.activeStyleId).toBe('custom-1');
  });
});
