import type { Settings } from '../types';
import './options.css';

const form = document.getElementById('settings-form') as HTMLFormElement;
const providerEl = document.getElementById('provider') as HTMLSelectElement;
const apiKeyEl = document.getElementById('apiKey') as HTMLInputElement;
const endpointEl = document.getElementById('endpoint') as HTMLInputElement;
const modelEl = document.getElementById('model') as HTMLInputElement;
const targetLangEl = document.getElementById('targetLang') as HTMLSelectElement;
const saveStatus = document.getElementById('save-status') as HTMLSpanElement;
const endpointField = document.getElementById('endpoint-field') as HTMLDivElement;

const MODEL_DEFAULTS: Record<string, string> = {
  openai: 'gpt-4o',
  claude: 'claude-3-5-sonnet-20241022',
};

// 加载已保存的设置
chrome.storage.sync.get(
  { provider: 'openai', apiKey: '', model: 'gpt-4o', endpoint: '', targetLang: '中文' },
  (items) => {
    const s = items as unknown as Settings;
    providerEl.value = s.provider;
    apiKeyEl.value = s.apiKey;
    endpointEl.value = s.endpoint;
    modelEl.value = s.model;
    targetLangEl.value = s.targetLang;
    updateEndpointVisibility(s.provider);
  }
);

// Claude 不需要自定义 endpoint 字段（可选隐藏）
providerEl.addEventListener('change', () => {
  const provider = providerEl.value;
  updateEndpointVisibility(provider);
  if (!modelEl.value || Object.values(MODEL_DEFAULTS).includes(modelEl.value)) {
    modelEl.value = MODEL_DEFAULTS[provider] || '';
  }
});

function updateEndpointVisibility(provider: string) {
  endpointField.style.display = provider === 'claude' ? 'none' : 'block';
}

// 保存设置
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const settings: Settings = {
    provider: providerEl.value as Settings['provider'],
    apiKey: apiKeyEl.value.trim(),
    model: modelEl.value.trim(),
    endpoint: endpointEl.value.trim(),
    targetLang: targetLangEl.value,
  };

  chrome.storage.sync.set(settings, () => {
    saveStatus.textContent = '已保存 ✓';
    setTimeout(() => { saveStatus.textContent = ''; }, 2000);
  });
});
