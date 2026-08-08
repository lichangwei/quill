import { testConnection } from '../ai/service';
import {
  MODEL_NAME_MAX_LENGTH,
  MODEL_STORAGE_KEY,
  addModel,
  getModelState,
  removeModel,
  setDefaultModel,
  setModelEnabled,
  updateModel,
  validateModelConfig,
} from '../settings/storage';
import { getActionGroups } from '../actions/storage';
import * as Types from '../types';
import { createElement, Pencil } from 'lucide';
import './options.css';

const content = document.getElementById('options-content') as HTMLElement;
const modelDialog = document.getElementById('model-dialog') as HTMLDialogElement;
const modelForm = document.getElementById('model-form') as HTMLFormElement;
const modelName = document.getElementById('model-name') as HTMLInputElement;
const modelBaseUrl = document.getElementById('model-base-url') as HTMLInputElement;
const modelApiKey = document.getElementById('model-api-key') as HTMLInputElement;
const modelId = document.getElementById('model-id') as HTMLInputElement;
const modelStatus = document.getElementById('model-form-status') as HTMLParagraphElement;
const modelTest = document.getElementById('model-test') as HTMLButtonElement;
const confirmDialog = document.getElementById('confirm-dialog') as HTMLDialogElement;
const confirmDescription = document.getElementById('confirm-description') as HTMLParagraphElement;
const confirmAction = document.getElementById('confirm-action') as HTMLButtonElement;

let modelState: Types.ModelConfigState = { models: [], defaultModelId: null, activeModelId: null };
let editingModelId: string | null = null;
let confirmHandler: (() => Promise<void>) | null = null;
let activeSection: 'model' | 'prompt' = 'model';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, className: string, onClick: () => void, title?: string): HTMLButtonElement {
  const node = element('button', className, text);
  node.type = 'button';
  if (title) {
    node.title = title;
    node.setAttribute('aria-label', title);
  }
  node.addEventListener('click', onClick);
  return node;
}

function badge(text: string, variant: 'success' | 'info' | 'default' = 'default'): HTMLSpanElement {
  return element('span', `badge ${variant}`, text);
}

function sectionHeading(title: string, description: string, action: HTMLElement): HTMLDivElement {
  const heading = element('div', 'section-heading heading-with-action');
  const copy = element('div');
  copy.append(element('h2', undefined, title), element('p', undefined, description));
  heading.append(copy, action);
  return heading;
}

function showFormStatus(node: HTMLParagraphElement, message: string, success = false): void {
  node.hidden = !message;
  node.textContent = message;
  node.className = `form-status ${success ? 'success' : 'error'}`;
}

function updateCount(input: HTMLInputElement | HTMLTextAreaElement, targetId: string, limit: number): void {
  const count = document.getElementById(targetId) as HTMLSpanElement;
  count.textContent = `${input.value.length}/${limit}`;
}

function modelValues() {
  return {
    name: modelName.value.trim(),
    baseUrl: modelBaseUrl.value.trim(),
    apiKey: modelApiKey.value.trim(),
    modelId: modelId.value.trim(),
  };
}

function openModelDialog(model?: Types.ModelProfile): void {
  editingModelId = model?.id ?? null;
  (document.getElementById('model-dialog-title') as HTMLElement).textContent = model ? '编辑模型' : '新增模型';
  modelName.value = model?.name ?? '';
  modelBaseUrl.value = model?.baseUrl ?? '';
  modelApiKey.value = model?.apiKey ?? '';
  modelId.value = model?.modelId ?? '';
  updateCount(modelName, 'model-name-count', MODEL_NAME_MAX_LENGTH);
  showFormStatus(modelStatus, '');
  modelTest.disabled = false;
  modelTest.textContent = '测试连接';
  modelDialog.showModal();
}

function openConfirm(description: string, handler: () => Promise<void>): void {
  confirmDescription.textContent = description;
  confirmHandler = handler;
  confirmDialog.showModal();
}

function settingsListItem(title: string, subtitle: string): { item: HTMLDivElement; titleRow: HTMLDivElement; actions: HTMLDivElement } {
  const item = element('div', 'settings-list-item');
  const copy = element('div', 'settings-list-copy');
  const titleRow = element('div', 'settings-list-title');
  titleRow.append(element('strong', undefined, title));
  copy.append(titleRow, element('span', undefined, subtitle));
  const actions = element('div', 'settings-actions');
  item.append(copy, actions);
  return { item, titleRow, actions };
}

function renderModels(): void {
  const section = element('section', 'settings-section');
  section.append(sectionHeading(
    '模型',
    '配置多套 OpenAI 兼容模型。模型名称用于区分相同 Base URL 下不同的模型 ID，信息只保存在本地。',
    button('新增模型', 'button primary', () => openModelDialog()),
  ));
  if (modelState.models.length === 0) {
    section.append(element('p', 'empty-state', '暂无模型配置'));
  } else {
    const list = element('div', 'settings-list');
    for (const model of modelState.models) {
      const row = settingsListItem(model.name, `${model.modelId} · ${model.baseUrl}`);
      if (model.id === modelState.defaultModelId) row.titleRow.append(badge('默认', 'success'));
      if (!model.enabled) row.titleRow.append(badge('已停用'));
      const toggle = element('label', 'switch-control');
      const checkbox = element('input') as HTMLInputElement;
      checkbox.type = 'checkbox';
      checkbox.checked = model.enabled;
      checkbox.setAttribute('aria-label', `${model.name}启用开关`);
      checkbox.addEventListener('change', () => void setModelEnabled(model.id, checkbox.checked).then(reload));
      toggle.append(checkbox, element('span', 'switch-track'));
      const editButton = button('', 'icon-button', () => openModelDialog(model), `编辑${model.name}`);
      editButton.append(createElement(Pencil, { 'aria-hidden': 'true' }));
      row.actions.append(
        toggle,
        editButton,
        button('☆', 'icon-button', () => void setDefaultModel(model.id).then(reload), `设${model.name}为默认`),
        button('×', 'icon-button danger-text', () => openConfirm(`确定要删除模型「${model.name}」吗？此操作无法撤销。`, async () => {
          await removeModel(model.id);
          await reload();
        }), `删除${model.name}`),
      );
      (row.actions.children[2] as HTMLButtonElement).disabled = model.id === modelState.defaultModelId;
      (row.actions.children[3] as HTMLButtonElement).disabled = modelState.models.length <= 1;
      list.append(row.item);
    }
    section.append(list);
  }
  content.replaceChildren(section);
}

function renderPagePrompts(): void {
  const section = element('section', 'settings-section');
  section.append(sectionHeading('网页提示词', '查看已保存网页动作及其绑定信息。', element('span')));
  void getActionGroups().then((groups) => {
    const rows: HTMLTableRowElement[] = [];
    for (const group of groups) {
      const pageName = group.pageName || '未记录网页名称';
      const fieldName = group.fieldName || '未记录输入框名称';
      for (const action of group.actions) {
        const row = document.createElement('tr');
        [pageName, fieldName, action.name, action.prompt]
          .forEach((value) => row.append(element('td', undefined, value)));
        rows.push(row);
      }
    }
    if (rows.length === 0) {
      section.append(element('p', 'empty-state', '暂无网页提示词'));
    } else {
      const table = document.createElement('table');
      table.className = 'prompt-table';
      const head = document.createElement('tr');
      ['网页名称', '输入框名称', '动作', '动作提示词']
        .forEach((value) => head.append(element('th', undefined, value)));
      const thead = document.createElement('thead');
      thead.append(head);
      const tbody = document.createElement('tbody');
      tbody.append(...rows);
      table.append(thead, tbody);
      const wrapper = element('div', 'table-scroll');
      wrapper.append(table);
      section.append(wrapper);
    }
    if (activeSection === 'prompt') content.replaceChildren(section);
  }).catch((error: unknown) => {
    section.append(element('p', 'form-status error', error instanceof Error ? error.message : String(error)));
    if (activeSection === 'prompt') content.replaceChildren(section);
  });
  content.replaceChildren(section);
}

function renderActiveSection(): void {
  if (activeSection === 'prompt') renderPagePrompts();
  else renderModels();
}

async function reload(): Promise<void> {
  modelState = await getModelState();
  renderActiveSection();
}

document.querySelectorAll<HTMLButtonElement>('.options-nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    activeSection = item.dataset.section === 'prompt' ? 'prompt' : 'model';
    document.querySelectorAll('.options-nav-item').forEach((nav) => nav.classList.toggle('is-active', nav === item));
    renderActiveSection();
  });
});

document.querySelectorAll<HTMLButtonElement>('.dialog-close, .dialog-cancel').forEach((item) => {
  item.addEventListener('click', () => (item.closest('dialog') as HTMLDialogElement).close());
});

modelName.addEventListener('input', () => updateCount(modelName, 'model-name-count', MODEL_NAME_MAX_LENGTH));

modelForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const model = modelValues();
  const error = validateModelConfig(model);
  if (error) {
    showFormStatus(modelStatus, error);
    return;
  }
  const operation = editingModelId ? updateModel(editingModelId, model) : addModel(model);
  void operation.then(async () => {
    modelDialog.close();
    await reload();
  }).catch((saveError: unknown) => showFormStatus(modelStatus, saveError instanceof Error ? saveError.message : String(saveError)));
});

modelTest.addEventListener('click', () => {
  const model = modelValues();
  const error = validateModelConfig(model);
  if (error) {
    showFormStatus(modelStatus, error);
    return;
  }
  modelTest.disabled = true;
  modelTest.textContent = '测试中...';
  void testConnection(model).then((result) => {
    showFormStatus(modelStatus, result.success ? `连接成功，耗时 ${result.latencyMs}ms` : result.error ?? '连接失败', result.success);
  }).finally(() => {
    modelTest.disabled = false;
    modelTest.textContent = '测试连接';
  });
});

confirmAction.addEventListener('click', () => {
  if (!confirmHandler) return;
  confirmAction.disabled = true;
  void confirmHandler().finally(() => {
    confirmAction.disabled = false;
    confirmHandler = null;
    confirmDialog.close();
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && MODEL_STORAGE_KEY in changes) void reload();
});

void reload().catch((error: unknown) => {
  content.replaceChildren(element('p', 'form-status error', error instanceof Error ? error.message : String(error)));
});
