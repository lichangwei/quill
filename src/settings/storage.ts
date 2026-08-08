import * as Types from '../types';

export const MODEL_STORAGE_KEY = 'quill:model-config';
export const STYLE_STORAGE_KEY = 'quill:style-config';
export const MODEL_NAME_MAX_LENGTH = 30;
export const STYLE_NAME_MAX_LENGTH = 20;
export const STYLE_DESCRIPTION_MAX_LENGTH = 200;

export const BUILT_IN_STYLES: Types.WritingStyle[] = [
  { id: 'formal', name: '正式', description: '语气正式、措辞严谨，适合对外或对上级沟通。', builtIn: true },
  { id: 'concise', name: '简洁', description: '语言精炼，直接给出结论和必要信息，不做客套铺垫。', builtIn: true },
  { id: 'friendly', name: '友好', description: '语气自然亲切，像同事间日常沟通，但仍保持专业。', builtIn: true },
];

const DEFAULT_MODEL_STATE: Types.ModelConfigState = {
  models: [],
  defaultModelId: null,
  activeModelId: null,
};

const DEFAULT_STYLE_STATE: Types.WritingStyleState = {
  styles: BUILT_IN_STYLES,
  defaultStyleId: 'formal',
  activeStyleId: 'formal',
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

function normalizeStyle(value: unknown): Types.WritingStyle | null {
  if (!isRecord(value) || value.builtIn !== false) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.description !== 'string') return null;
  const name = value.name.trim().slice(0, STYLE_NAME_MAX_LENGTH);
  const description = value.description.trim().slice(0, STYLE_DESCRIPTION_MAX_LENGTH);
  return value.id && name && description ? { id: value.id, name, description, builtIn: false } : null;
}

export function normalizeStyleState(value: unknown): Types.WritingStyleState {
  const customStyles = isRecord(value) && Array.isArray(value.styles)
    ? value.styles.map(normalizeStyle).filter((style): style is Types.WritingStyle => style !== null)
    : [];
  const styles = BUILT_IN_STYLES.concat(customStyles);
  const storedDefaultId = isRecord(value) && typeof value.defaultStyleId === 'string' ? value.defaultStyleId : '';
  const storedActiveId = isRecord(value) && typeof value.activeStyleId === 'string' ? value.activeStyleId : '';
  const defaultStyleId = styles.some((style) => style.id === storedDefaultId) ? storedDefaultId : DEFAULT_STYLE_STATE.defaultStyleId;
  return {
    styles,
    defaultStyleId,
    activeStyleId: styles.some((style) => style.id === storedActiveId) ? storedActiveId : defaultStyleId,
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

export async function getStyleState(): Promise<Types.WritingStyleState> {
  return normalizeStyleState(await storageGet(chrome.storage.local, STYLE_STORAGE_KEY));
}

export async function saveStyleState(state: Types.WritingStyleState): Promise<void> {
  await storageSet(STYLE_STORAGE_KEY, normalizeStyleState(state));
}

export async function addStyle(name: string, description: string): Promise<void> {
  const state = await getStyleState();
  state.styles.push({
    id: createId('custom'),
    name: name.trim().slice(0, STYLE_NAME_MAX_LENGTH),
    description: description.trim().slice(0, STYLE_DESCRIPTION_MAX_LENGTH),
    builtIn: false,
  });
  await saveStyleState(state);
}

export async function updateStyle(id: string, name: string, description: string): Promise<void> {
  const state = await getStyleState();
  state.styles = state.styles.map((style) => style.id === id && !style.builtIn ? {
    ...style,
    name: name.trim().slice(0, STYLE_NAME_MAX_LENGTH),
    description: description.trim().slice(0, STYLE_DESCRIPTION_MAX_LENGTH),
  } : style);
  await saveStyleState(state);
}

export async function removeStyle(id: string): Promise<void> {
  const state = await getStyleState();
  const style = state.styles.find((item) => item.id === id);
  if (!style || style.builtIn || state.defaultStyleId === id || state.activeStyleId === id) return;
  state.styles = state.styles.filter((item) => item.id !== id);
  await saveStyleState(state);
}

export async function setDefaultStyle(id: string): Promise<void> {
  const state = await getStyleState();
  if (state.styles.some((style) => style.id === id)) {
    state.defaultStyleId = id;
    state.activeStyleId = id;
    await saveStyleState(state);
  }
}

export async function setActiveStyle(id: string): Promise<void> {
  const state = await getStyleState();
  if (state.styles.some((style) => style.id === id)) {
    state.activeStyleId = id;
    await saveStyleState(state);
  }
}
