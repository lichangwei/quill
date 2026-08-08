import * as Types from '../types';

export const MODEL_STORAGE_KEY = 'quill:model-config';
export const MODEL_NAME_MAX_LENGTH = 30;

const DEFAULT_MODEL_STATE: Types.ModelConfigState = {
  models: [],
  defaultModelId: null,
  activeModelId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createId(prefix: string): string {
  return [prefix, Date.now(), Math.random().toString(36).slice(2, 8)].join('-');
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateModelConfig(config: Types.ModelConfig & { name?: string }): string | null {
  if (config.name !== undefined && !config.name.trim()) return '请填写模型名称';
  if (config.name !== undefined && config.name.trim().length > MODEL_NAME_MAX_LENGTH) {
    return `模型名称不能超过 ${MODEL_NAME_MAX_LENGTH} 个字符`;
  }
  if (!config.baseUrl.trim()) return '请填写 Base URL';
  if (!isValidUrl(config.baseUrl.trim())) return 'Base URL 格式不正确';
  if (!config.apiKey.trim()) return '请填写 API Key';
  if (!config.modelId.trim()) return '请填写模型 ID';
  return null;
}

function normalizeModel(value: unknown): Types.ModelProfile | null {
  if (!isRecord(value)) return null;
  const model: Types.ModelProfile = {
    id: typeof value.id === 'string' ? value.id : '',
    name: typeof value.name === 'string' ? value.name : '',
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    modelId: typeof value.modelId === 'string' ? value.modelId : '',
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
  };
  return model.id && validateModelConfig(model) === null ? model : null;
}

export function normalizeModelState(value: unknown): Types.ModelConfigState {
  if (!isRecord(value) || !Array.isArray(value.models)) return { ...DEFAULT_MODEL_STATE };
  const models = value.models.map(normalizeModel).filter((model): model is Types.ModelProfile => model !== null);
  const firstId = models[0]?.id ?? null;
  return {
    models,
    defaultModelId: typeof value.defaultModelId === 'string' && models.some((model) => model.id === value.defaultModelId)
      ? value.defaultModelId
      : firstId,
    activeModelId: typeof value.activeModelId === 'string' && models.some((model) => model.id === value.activeModelId)
      ? value.activeModelId
      : firstId,
  };
}

function storageGet(area: chrome.storage.StorageArea, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    area.get(key, (items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(items[key]);
    });
  });
}

function storageSet(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

async function migrateLegacyModel(): Promise<Types.ModelConfigState | null> {
  const value = await new Promise<Record<string, unknown>>((resolve, reject) => {
    chrome.storage.sync.get(['provider', 'apiKey', 'model', 'endpoint'], (items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(items);
    });
  });
  if (value.provider !== 'openai' || typeof value.apiKey !== 'string' || !value.apiKey.trim()) return null;
  const endpoint = typeof value.endpoint === 'string' && value.endpoint.trim()
    ? value.endpoint.trim().replace(/\/chat\/completions\/?$/, '')
    : 'https://api.openai.com/v1';
  const modelId = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : 'gpt-4o';
  const id = createId('model');
  const state: Types.ModelConfigState = {
    models: [{ id, name: '模型 1', baseUrl: endpoint, apiKey: value.apiKey.trim(), modelId, enabled: true }],
    defaultModelId: id,
    activeModelId: id,
  };
  await storageSet(MODEL_STORAGE_KEY, state);
  await new Promise<void>((resolve) => chrome.storage.sync.remove(['provider', 'apiKey', 'model', 'endpoint'], resolve));
  return state;
}

export async function getModelState(): Promise<Types.ModelConfigState> {
  const stored = await storageGet(chrome.storage.local, MODEL_STORAGE_KEY);
  const state = normalizeModelState(stored);
  if (state.models.length > 0) return state;
  return await migrateLegacyModel() ?? state;
}

export async function saveModelState(state: Types.ModelConfigState): Promise<void> {
  await storageSet(MODEL_STORAGE_KEY, normalizeModelState(state));
}

export async function addModel(model: Types.ModelConfig & { name: string; enabled?: boolean }): Promise<string> {
  const state = await getModelState();
  const id = createId('model');
  state.models.push({ ...model, id, enabled: model.enabled ?? true });
  state.defaultModelId ??= id;
  state.activeModelId ??= id;
  await saveModelState(state);
  return id;
}

export async function updateModel(id: string, model: Types.ModelConfig & { name: string }): Promise<void> {
  const state = await getModelState();
  state.models = state.models.map((item) => item.id === id ? { ...model, id, enabled: item.enabled } : item);
  await saveModelState(state);
}

export async function setModelEnabled(id: string, enabled: boolean): Promise<void> {
  const state = await getModelState();
  state.models = state.models.map((model) => model.id === id ? { ...model, enabled } : model);
  await saveModelState(state);
}

export async function removeModel(id: string): Promise<void> {
  const state = await getModelState();
  if (state.models.length <= 1) return;
  state.models = state.models.filter((model) => model.id !== id);
  const firstId = state.models[0]?.id ?? null;
  if (state.defaultModelId === id) state.defaultModelId = firstId;
  if (state.activeModelId === id) state.activeModelId = state.defaultModelId ?? firstId;
  await saveModelState(state);
}

export async function setDefaultModel(id: string): Promise<void> {
  const state = await getModelState();
  if (state.models.some((model) => model.id === id)) {
    state.defaultModelId = id;
    await saveModelState(state);
  }
}

export async function setActiveModel(id: string): Promise<void> {
  const state = await getModelState();
  if (state.models.some((model) => model.id === id)) {
    state.activeModelId = id;
    await saveModelState(state);
  }
}
