import type {
  EditorState,
  ElementPickerResult,
  ElementTarget,
  PageElementReference,
  StoredAction,
  StoredActionGroup,
} from '../types';
import { createElement, Check, createIcons, icons, Pencil, X } from 'lucide';
import { getDisableState, setDisableRule } from '../settings/disable-rules';
import { mountPageChat } from './page-chat/PageChat';
import {
  DEFAULT_POLISH_PROMPT,
  POLISH_ID,
  deleteAction,
  getActionGroups,
  getPageActionGroups,
  mergePolishAction,
  resetPolishAction,
  saveActionGroup,
  savePolishAction,
  selectorToTarget,
  targetToSelector,
} from '../actions/storage';


const app = document.querySelector<HTMLElement>('#app')!;
let pageChatOpen = false;
let currentTabId: number | undefined;
let view: 'list' | 'edit' = 'list';
// ✦ 打开时通过 storage.session 传入的深链状态，消费一次以在 tab 事件竞态中收敛到编辑页。
let pendingDeepLink: EditorState | null = null;
let state: EditorState | null = null;
let activeGroup: StoredActionGroup | null = null;
let editingAction: StoredAction | null = null;
let editingPageReferences: PageElementReference[] = [];
let pendingPickerResult: ElementPickerResult | null = null;
let promptInsertionRange: Range | null = null;
let draggingPromptTag: HTMLElement | null = null;
let promptDropCaret: HTMLElement | null = null;
let valueTooltip: HTMLDivElement | null = null;
let valueRequestId = 0;
createIcons({ icons });
document.querySelector<HTMLButtonElement>('.settings-button')!.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
});
document.querySelector<HTMLButtonElement>('.page-chat-toggle')!.addEventListener('click', () => {
  pageChatOpen = !pageChatOpen;
  void showListForCurrentTab();
});
let refreshRequestId = 0;

document.addEventListener('keydown', (event) => {
  const pickerButton = document.querySelector<HTMLButtonElement>('.pick-element');
  if (!pickerButton?.disabled) return;
  if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Escape') return;
  event.preventDefault();
  void getEditorTabId().then((tabId) => {
    chrome.tabs.sendMessage(tabId, { type: event.key === 'Escape' ? 'CANCEL_ELEMENT_PICKER' : 'CONFIRM_ELEMENT_PICKER' });
  });
});

async function renderDisableControls(url: string): Promise<void> {
  const controls = document.querySelector<HTMLElement>('.disable-controls');
  if (!controls) return;
  const siteButton = controls.querySelector<HTMLButtonElement>('.disable-site')!;
  const supported = /^https?:\/\//i.test(url);
  const state = await getDisableState(url);
  controls.hidden = false;
  siteButton.disabled = !supported;
  siteButton.title = supported
    ? (state.site ? '启用此网站插件' : '禁用此网站插件')
    : '当前页面类型不支持注入插件脚本';
  siteButton.setAttribute('aria-label', siteButton.title);
  siteButton.onclick = async () => {
    await setDisableRule(url, 'site', !state.site);
    await chrome.tabs.reload();
  };
  let status = document.querySelector<HTMLElement>('.disable-status');
  if (!status) { status = document.createElement('div'); status.className = 'disable-status'; document.querySelector('main')!.prepend(status); }
  status.textContent = state.page ? '该页面已经禁用该插件' : state.site ? '该网站已经禁用该插件' : '';
}

function field(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

type MetaField = 'pageName' | 'fieldName';

function metaValue(name: MetaField): string {
  if (!activeGroup || !state) return '';
  const value = name === 'pageName'
    ? activeGroup.pageName || state.pageName
    : activeGroup.fieldName || state.fieldName || '输入框';
  return (value || '').trim();
}

function setMetaEditing(name: MetaField, editing: boolean): void {
  const row = document.querySelector<HTMLElement>(`.meta-row[data-meta="${name}"]`);
  if (!row) return;
  row.classList.toggle('editing', editing);
  row.querySelector<HTMLElement>('.meta-display')!.hidden = editing;
  row.querySelector<HTMLElement>('.meta-editor')!.hidden = !editing;
  if (editing) row.querySelector<HTMLInputElement>('input')!.focus();
}

async function saveMetaField(name: MetaField): Promise<void> {
  if (!activeGroup) return;
  const value = field(name).value.trim();
  const updatedGroup: StoredActionGroup = { ...activeGroup, [name]: value };
  await saveActionGroup(updatedGroup, activeGroup);
  activeGroup = updatedGroup;
  if (state) state = { ...state, group: updatedGroup, [name]: value };
  render();
}

function bindMetaEditors(): void {
  (['pageName', 'fieldName'] as MetaField[]).forEach((name) => {
    const row = document.querySelector<HTMLElement>(`.meta-row[data-meta="${name}"]`)!;
    row.querySelector<HTMLElement>('.meta-value-wrap')!.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      setMetaEditing(name, true);
    });
    row.querySelector<HTMLButtonElement>('.meta-edit')!.addEventListener('click', () => setMetaEditing(name, true));
    row.querySelector<HTMLButtonElement>('.meta-save')!.addEventListener('click', () => {
      void saveMetaField(name).catch((error) => {
        const status = document.querySelector<HTMLElement>('.meta-status')!;
        status.textContent = error instanceof Error ? error.message : String(error);
      });
    });
    row.querySelector<HTMLButtonElement>('.meta-cancel')!.addEventListener('click', () => {
      field(name).value = metaValue(name);
      setMetaEditing(name, false);
    });
    row.querySelector<HTMLInputElement>('input')!.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void saveMetaField(name);
      } else if (event.key === 'Escape') {
        field(name).value = metaValue(name);
        setMetaEditing(name, false);
      }
    });
  });
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.className = className;
  element.addEventListener('click', onClick);
  return element;
}

function groupDisplayName(group: StoredActionGroup): string {
  return (group.fieldName || group.pageName || group.selector || '未命名元素').trim();
}

function renderList(groups: StoredActionGroup[]): void {
  app.classList.remove('page-chat-mode');
  if (pageChatOpen) { if (currentTabId !== undefined) mountPageChat(app, { tabId: currentTabId, onBack: () => { pageChatOpen = false; void showListForCurrentTab(); } }); return; }
  view = 'list';
  if (groups.length === 0) {
    app.innerHTML = '<p class="empty">当前页面还没有配置动作元素。在输入框上点击 ✦ 按钮即可添加。</p>';
    return;
  }
  app.innerHTML = `
    <section class="section">
      <div class="toolbar"><h2 class="section-title">当前页面的元素</h2></div>
      <div class="page-element-list"></div>
    </section>`;
  const container = app.querySelector<HTMLElement>('.page-element-list')!;
  container.replaceChildren(...groups.map((group) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'page-element-row';
    const name = document.createElement('span');
    name.className = 'page-element-name';
    name.textContent = groupDisplayName(group);
    const ops = group.actions.filter((action) => action.id !== POLISH_ID).map((action) => action.name);
    const meta = document.createElement('span');
    meta.className = 'page-element-ops';
    meta.textContent = ops.length ? ops.join('、') : '仅默认动作';
    row.append(name, meta);
    row.addEventListener('click', () => openGroupEditor(group));
    return row;
  }));
}

/**
 * 查询当前活动标签页 URL，展示该页已配置的元素列表。
 * 若存在指向当前标签页的 ✦ 深链（pendingDeepLink），则优先打开对应元素的编辑页。
 */
async function showListForCurrentTab(): Promise<void> {
  const requestId = ++refreshRequestId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  const groups = await getActionGroups();
  await renderDisableControls(tab?.url ?? '');
  if (requestId !== refreshRequestId) return;
  if (pendingDeepLink && pendingDeepLink.tabId === tab?.id) {
    const deepLink = pendingDeepLink;
    pendingDeepLink = null;
    await loadState(deepLink);
    return;
  }
  pendingDeepLink = null;
  state = null;
  activeGroup = null;
  editingAction = null;
  editingPageReferences = [];
  pendingPickerResult = null;
  promptInsertionRange = null;
  renderList(getPageActionGroups(groups, tab?.url ?? ''));
}

/**
 * 从列表进入单元素编辑器。合成完整 EditorState，使编辑视图内所有 state 读取保持有效；
 * 故意不带 tabId，让 picker / 取值走当前活动标签页（即被跟随的页面）。
 */
function openGroupEditor(group: StoredActionGroup): void {
  activeGroup = { ...group, actions: group.actions.map((action) => ({ ...action })) };
  state = {
    url: group.url,
    selector: group.selector,
    target: selectorToTarget(group.selector),
    group: activeGroup,
    ...(group.pageName ? { pageName: group.pageName } : {}),
    ...(group.fieldName ? { fieldName: group.fieldName } : {}),
  };
  view = 'edit';
  editingAction = null;
  render();
}

function render(): void {
  if (!state || !activeGroup) {
    void showListForCurrentTab();
    return;
  }
  app.innerHTML = `
    <div class="editor-toolbar"><button type="button" class="back-button">← 返回列表</button></div>
    <section class="section metadata-section">
      <div class="meta-status" aria-live="polite"></div>
      <div class="meta-row" data-meta="pageName">
        <div class="meta-display"><span class="meta-label">网页名称</span><span class="meta-value-wrap"><span class="meta-value"></span><button type="button" class="meta-edit" title="编辑网页名称" aria-label="编辑网页名称"></button></span></div>
        <div class="meta-editor" hidden><span class="meta-label">网页名称</span><input name="pageName" type="text" /><button type="button" class="meta-save" title="保存" aria-label="保存"></button><button type="button" class="meta-cancel" title="取消" aria-label="取消"></button></div>
      </div>
      <div class="meta-row" data-meta="fieldName">
        <div class="meta-display"><span class="meta-label">绑定元素</span><span class="meta-value-wrap"><span class="meta-value"></span><button type="button" class="meta-edit" title="编辑绑定元素" aria-label="编辑绑定元素"></button></span></div>
        <div class="meta-editor" hidden><span class="meta-label">绑定元素</span><input name="fieldName" type="text" /><button type="button" class="meta-save" title="保存" aria-label="保存"></button><button type="button" class="meta-cancel" title="取消" aria-label="取消"></button></div>
      </div>
      <div class="field" hidden><label>URL 规则<input name="urlPattern" type="text" /></label></div>
      <div class="field" hidden><label>元素类型<select name="targetKind"><option value="id">ID</option><option value="selector">CSS 选择器</option></select></label></div>
      <div class="field" hidden><label>元素标识<input name="targetValue" type="text" /></label></div>
    </section>
    <section class="section">
      <div class="toolbar"><h2 class="section-title">动作</h2></div>
      <div class="action-list"></div>
      <form id="action-form" hidden>
        <div class="field"><label>名称<input name="name" type="text" maxlength="40" required /></label></div>
        <div class="field prompt-field">
          <div class="prompt-header"><label for="prompt">Prompt</label><span class="prompt-tools"><button type="button" class="insert-current">插入当前元素值</button><button type="button" class="pick-element">选择页面元素</button></span></div>
          <div id="prompt" class="prompt-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="输入提示词，{content} 表示当前输入框"></div>
          <input name="prompt" type="hidden" />
          <div class="picker-status" aria-live="polite"></div>
          <div class="reference-name-form" hidden>
            <label>字段名称<input name="referenceName" type="text" maxlength="30" /></label>
            <div class="reference-name-actions"><button type="button" class="confirm-reference primary">添加到 Prompt</button><button type="button" class="cancel-reference">取消</button></div>
          </div>
        </div>
        <div class="warning" hidden></div>
        <div class="form-actions">
          <button type="submit" class="primary">保存</button>
          <button type="button" class="reset" hidden>恢复默认</button>
          <button type="button" class="cancel">取消</button>
        </div>
      </form>
    </section>`;

  void renderDisableControls(state.url);

  field('urlPattern').value = activeGroup.url;
  (['pageName', 'fieldName'] as MetaField[]).forEach((name) => {
    const value = metaValue(name);
    field(name).value = value;
    document.querySelector<HTMLElement>(`.meta-row[data-meta="${name}"] .meta-value`)!.textContent = value || '未设置';
    document.querySelector<HTMLElement>(`.meta-row[data-meta="${name}"] .meta-edit`)!.append(createElement(Pencil, { 'aria-hidden': 'true' }));
    document.querySelector<HTMLElement>(`.meta-row[data-meta="${name}"] .meta-save`)!.append(createElement(Check, { 'aria-hidden': 'true' }));
    document.querySelector<HTMLElement>(`.meta-row[data-meta="${name}"] .meta-cancel`)!.append(createElement(X, { 'aria-hidden': 'true' }));
  });
  bindMetaEditors();
  document.querySelector<HTMLButtonElement>('.back-button')!.addEventListener('click', () => {
    // 清除 ✦ 深链状态，让列表成为明确主页，避免重开时又跳回编辑页。
    void chrome.storage.session.remove('editorState');
    void showListForCurrentTab();
  });
  const target: ElementTarget = state && activeGroup.selector === targetToSelector(state.target)
    ? state.target
    : { kind: 'selector', value: activeGroup.selector };
  field('targetKind').value = target.kind;
  field('targetValue').value = target.value;
  renderActions();
  document.querySelector<HTMLFormElement>('#action-form')!.addEventListener('submit', (event) => void submitAction(event));
  document.querySelector('.cancel')!.addEventListener('click', closeForm);
  document.querySelector('.reset')!.addEventListener('click', () => void resetPolish());
  const pickElementButton = document.querySelector<HTMLButtonElement>('.pick-element')!;
  pickElementButton.addEventListener('mousedown', capturePromptInsertionRange);
  pickElementButton.addEventListener('click', () => void pickPageElement());
  const insertCurrentButton = document.querySelector<HTMLButtonElement>('.insert-current')!;
  insertCurrentButton.addEventListener('mousedown', capturePromptInsertionRange);
  insertCurrentButton.addEventListener('click', insertCurrentElementReference);
  document.querySelector('.confirm-reference')!.addEventListener('click', confirmPickedElement);
  document.querySelector('.cancel-reference')!.addEventListener('click', cancelPickedElement);
  field('referenceName').addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') {
      event.preventDefault();
      confirmPickedElement();
    }
  });
  const promptEditor = document.querySelector<HTMLElement>('.prompt-editor')!;
  promptDropCaret = document.createElement('span');
  promptDropCaret.className = 'prompt-drop-caret';
  promptDropCaret.hidden = true;
  promptEditor.append(promptDropCaret);
  promptEditor.addEventListener('input', syncPromptValue);
  promptEditor.addEventListener('keydown', handlePromptKeydown);
  promptEditor.addEventListener('paste', handlePromptPaste);
  promptEditor.addEventListener('click', handlePromptClick);
  promptEditor.addEventListener('dragstart', handlePromptDragStart);
  promptEditor.addEventListener('dragend', handlePromptDragEnd);
  promptEditor.addEventListener('dragover', handlePromptDragOver);
  promptEditor.addEventListener('drop', handlePromptDrop);
  promptEditor.addEventListener('mouseover', handlePromptTagMouseOver);
  promptEditor.addEventListener('mouseout', handlePromptTagMouseOut);
}

async function renderActions(): Promise<void> {
  if (!activeGroup) return;
  const container = document.querySelector<HTMLElement>('.action-list')!;
  const actions = [...mergePolishAction(await getActionGroups()), ...activeGroup.actions.filter((item) => item.id !== POLISH_ID)];
  container.replaceChildren(...actions.map((action) => {
    const row = document.createElement('div');
    row.className = 'action-row';
    const name = document.createElement('span');
    name.className = 'action-name';
    name.textContent = action.name;
    row.append(name, button('编辑', '', () => openForm(action)));
    if (action.id !== POLISH_ID) row.append(button('删除', 'delete', () => void removeAction(action)));
    return row;
  }));
  const toolbar = document.querySelector('.toolbar')!;
  toolbar.querySelector('.new-action')?.remove();
  const newAction = button('新建动作', 'primary new-action', () => openForm());
  toolbar.append(newAction);
}

function openForm(action?: StoredAction): void {
  editingAction = action || null;
  editingPageReferences = action?.pageReferences?.map((reference) => ({ ...reference })) || [];
  const form = document.querySelector<HTMLFormElement>('#action-form')!;
  field('name').value = action?.name || '';
  field('name').disabled = action?.id === POLISH_ID;
  setPromptValue(action?.prompt || '');
  document.querySelector<HTMLElement>('.reset')!.hidden = action?.id !== POLISH_ID;
  document.querySelector<HTMLElement>('.warning')!.hidden = true;
  form.hidden = false;
  (action?.id === POLISH_ID ? promptEditor() : field('name')).focus();
}

function closeForm(): void {
  const form = document.querySelector<HTMLFormElement>('#action-form');
  if (form) form.hidden = true;
  editingAction = null;
  editingPageReferences = [];
  pendingPickerResult = null;
  promptInsertionRange = null;
}

function sendPickerMessage(tabId: number): Promise<ElementPickerResult> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'START_ELEMENT_PICKER' }, (response?: { result?: ElementPickerResult; error?: string }) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || '无法连接当前页面'));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else if (response?.result) {
        resolve(response.result);
      } else {
        reject(new Error('未获取到页面元素'));
      }
    });
  });
}

async function getEditorTabId(): Promise<number> {
  if (state?.tabId !== undefined) return state.tabId;
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (chrome.runtime.lastError || tabId === undefined) {
        reject(new Error(chrome.runtime.lastError?.message || '无法获取当前页面'));
      } else {
        resolve(tabId);
      }
    });
  });
}

function promptEditor(): HTMLElement {
  return document.querySelector<HTMLElement>('.prompt-editor')!;
}

function selectorToken(selector: string): string {
  return `{selector:${selector}}`;
}

function createPromptTag(reference: PageElementReference, token = selectorToken(reference.selector)): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'prompt-tag';
  tag.contentEditable = 'false';
  tag.draggable = true;
  if (token === '{content}') {
    tag.dataset.token = token;
  } else {
    tag.dataset.selector = reference.selector;
    if (reference.fallback) tag.dataset.fallback = JSON.stringify(reference.fallback);
  }
  const label = document.createElement('span');
  label.className = 'prompt-tag-label';
  label.textContent = reference.name;
  const remove = document.createElement('span');
  remove.className = 'prompt-tag-remove';
  remove.textContent = '×';
  tag.append(label, remove);
  return tag;
}

function setPromptValue(prompt: string): void {
  const editor = promptEditor();
  const nodes: Node[] = [];
  const pattern = /\{selector:([^{}]+)\}|\{content\}/g;
  let cursor = 0;
  for (const match of prompt.matchAll(pattern)) {
    const index = match.index || 0;
    if (index > cursor) nodes.push(document.createTextNode(prompt.slice(cursor, index)));
    if (match[0] === '{content}') {
      nodes.push(createPromptTag({ name: '当前元素值', selector: '' }, '{content}'));
      cursor = index + match[0].length;
      continue;
    }
    const selector = match[1].trim();
    const reference = editingPageReferences.find((item) => item.selector === selector)
      || { name: '页面字段', selector };
    nodes.push(createPromptTag(reference));
    cursor = index + match[0].length;
  }
  if (cursor < prompt.length) nodes.push(document.createTextNode(prompt.slice(cursor)));
  editor.replaceChildren(...nodes);
  syncPromptValue();
}

function serializePromptNode(node: Node): string {
  if (node instanceof Text) return node.data;
  if (!(node instanceof HTMLElement)) return '';
  if (node.classList.contains('prompt-tag')) return node.dataset.token || selectorToken(node.dataset.selector || '');
  if (node.tagName === 'BR') return '\n';
  const content = Array.from(node.childNodes).map(serializePromptNode).join('');
  return node === promptEditor() ? content : content + (node.tagName === 'DIV' || node.tagName === 'P' ? '\n' : '');
}

function syncPromptValue(): void {
  field('prompt').value = serializePromptNode(promptEditor());
}

function insertTextAtPromptSelection(text: string): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  syncPromptValue();
}

function handlePromptKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    insertTextAtPromptSelection('\n');
  }
}

function handlePromptPaste(event: ClipboardEvent): void {
  event.preventDefault();
  insertTextAtPromptSelection(event.clipboardData?.getData('text/plain') || '');
}

function handlePromptClick(event: MouseEvent): void {
  const remove = (event.target as Element).closest('.prompt-tag-remove');
  if (!remove) return;
  const tag = remove.closest<HTMLElement>('.prompt-tag');
  const selector = tag?.dataset.selector;
  tag?.remove();
  syncPromptValue();
  if (selector && !field('prompt').value.includes(selectorToken(selector))) {
    editingPageReferences = editingPageReferences.filter((reference) => reference.selector !== selector);
  }
}

function rangeAtPoint(event: DragEvent): Range | null {
  const point = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (point) return point;
  const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (!caret) return null;
  const range = document.createRange();
  range.setStart(caret.offsetNode, caret.offset);
  range.collapse(true);
  return range;
}

function handlePromptDragStart(event: DragEvent): void {
  const tag = (event.target as Element).closest<HTMLElement>('.prompt-tag');
  if (!tag) return;
  draggingPromptTag = tag;
  hidePromptDropCaret();
  tag.classList.add('dragging');
  event.dataTransfer?.setData('text/plain', tag.dataset.token || selectorToken(tag.dataset.selector || ''));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function handlePromptDragEnd(): void {
  draggingPromptTag?.classList.remove('dragging');
  draggingPromptTag = null;
  hidePromptDropCaret();
}

function handlePromptDragOver(event: DragEvent): void {
  if (!draggingPromptTag) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function handlePromptDrop(event: DragEvent): void {
  if (!draggingPromptTag) return;
  event.preventDefault();
  const editor = promptEditor();
  const range = rangeAtPoint(event);
  if (!range || !editor.contains(range.commonAncestorContainer)) return;
  if (range.intersectsNode(draggingPromptTag)) {
    hidePromptDropCaret();
    return;
  }
  showPromptDropCaret(range);
  const tag = draggingPromptTag;
  tag.remove();
  range.deleteContents();
  range.insertNode(tag);
  range.setStartAfter(tag);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  syncPromptValue();
  hidePromptDropCaret();
}

function showPromptDropCaret(range: Range): void {
  if (!promptDropCaret) return;
  const editor = promptEditor();
  const editorRect = editor.getBoundingClientRect();
  const rect = range.getBoundingClientRect();
  promptDropCaret.hidden = false;
  promptDropCaret.style.left = `${Math.max(1, rect.left - editorRect.left + editor.scrollLeft)}px`;
  promptDropCaret.style.top = `${Math.max(1, rect.top - editorRect.top + editor.scrollTop)}px`;
  promptDropCaret.style.height = `${Math.max(18, rect.height || 18)}px`;
}

function hidePromptDropCaret(): void {
  if (promptDropCaret) promptDropCaret.hidden = true;
}

function ensureValueTooltip(): HTMLDivElement {
  if (valueTooltip) return valueTooltip;
  valueTooltip = document.createElement('div');
  valueTooltip.className = 'element-value-tooltip';
  valueTooltip.hidden = true;
  document.body.append(valueTooltip);
  return valueTooltip;
}

function positionValueTooltip(event: MouseEvent): void {
  const tooltip = ensureValueTooltip();
  tooltip.style.left = `${Math.max(8, Math.min(event.clientX + 12, innerWidth - tooltip.offsetWidth - 8))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(event.clientY + 14, innerHeight - tooltip.offsetHeight - 8))}px`;
}

function hideValueTooltip(): void {
  valueRequestId += 1;
  if (valueTooltip) valueTooltip.hidden = true;
}

function readElementValue(tabId: number, selector: string, fallback?: unknown): Promise<{ found: boolean; value: string }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'READ_SELECTED_ELEMENT', selector, fallback }, (response?: { found?: boolean; value?: string }) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || '无法读取左侧页面元素'));
      } else {
        resolve({ found: Boolean(response?.found), value: response?.value || '' });
      }
    });
  });
}

function handlePromptTagMouseOver(event: MouseEvent): void {
  const tag = (event.target as Element).closest<HTMLElement>('.prompt-tag');
  if (!tag || (event.relatedTarget instanceof Node && tag.contains(event.relatedTarget))) return;
  const selector = tag.dataset.selector;
  if (!selector) return;
  let fallback: unknown;
  try {
    fallback = tag.dataset.fallback ? JSON.parse(tag.dataset.fallback) : undefined;
  } catch {
    fallback = undefined;
  }
  const tooltip = ensureValueTooltip();
  const requestId = ++valueRequestId;
  tooltip.textContent = '正在读取左侧页面元素...';
  tooltip.hidden = false;
  positionValueTooltip(event);
  void getEditorTabId().then((tabId) => readElementValue(tabId, selector, fallback)).then((result) => {
    if (requestId !== valueRequestId) return;
    tooltip.textContent = result.found
      ? (result.value || '（当前为空）')
      : '左侧页面中未找到该元素';
    tooltip.hidden = false;
    positionValueTooltip(event);
  }).catch((error) => {
    if (requestId !== valueRequestId) return;
    tooltip.textContent = error instanceof Error ? error.message : String(error);
  });
}

function handlePromptTagMouseOut(event: MouseEvent): void {
  const tag = (event.target as Element).closest<HTMLElement>('.prompt-tag');
  if (!tag || (event.relatedTarget instanceof Node && tag.contains(event.relatedTarget))) return;
  hideValueTooltip();
}

function capturePromptInsertionRange(): void {
  const selection = window.getSelection();
  if (selection?.rangeCount && promptEditor().contains(selection.anchorNode)) {
    promptInsertionRange = selection.getRangeAt(0).cloneRange();
  } else {
    const range = document.createRange();
    range.selectNodeContents(promptEditor());
    range.collapse(false);
    promptInsertionRange = range;
  }
}

function insertPromptReference(reference: PageElementReference, token = selectorToken(reference.selector)): void {
  const editor = promptEditor();
  const range = promptInsertionRange && editor.contains(promptInsertionRange.commonAncestorContainer)
    ? promptInsertionRange
    : document.createRange();
  if (!promptInsertionRange || !editor.contains(range.commonAncestorContainer)) {
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.deleteContents();
  const tag = createPromptTag(reference, token);
  const trailingSpace = document.createTextNode(' ');
  range.insertNode(trailingSpace);
  range.insertNode(tag);
  range.setStartAfter(trailingSpace);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  promptInsertionRange = null;
  syncPromptValue();
  editor.focus();
}

function insertCurrentElementReference(): void {
  insertPromptReference({ name: '当前元素值', selector: '' }, '{content}');
}

async function pickPageElement(): Promise<void> {
  const pickButton = document.querySelector<HTMLButtonElement>('.pick-element')!;
  const status = document.querySelector<HTMLElement>('.picker-status')!;
  pickButton.disabled = true;
  pickButton.textContent = '正在选择...';
  status.textContent = '请在左侧页面移动鼠标并点击目标元素，按 Esc 取消。';
  if (!promptInsertionRange) capturePromptInsertionRange();
  try {
    const result = await sendPickerMessage(await getEditorTabId());
    pendingPickerResult = result;
    const existing = editingPageReferences.find((reference) => reference.selector === result.selector);
    field('referenceName').value = existing?.name || result.name;
    document.querySelector<HTMLElement>('.reference-name-form')!.hidden = false;
    status.textContent = `已选择 ${result.tagName}，请填写字段名称。`;
    field('referenceName').focus();
    (field('referenceName') as HTMLInputElement).select();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    pickButton.disabled = false;
    pickButton.textContent = '选择页面元素';
  }
}

function confirmPickedElement(): void {
  if (!pendingPickerResult) return;
  const status = document.querySelector<HTMLElement>('.picker-status')!;
  const name = field('referenceName').value.replace(/\s+/g, ' ').trim();
  if (!name) {
    status.textContent = '请填写字段名称。';
    field('referenceName').focus();
    return;
  }
  const duplicateName = editingPageReferences.find((reference) => (
    reference.name === name && reference.selector !== pendingPickerResult?.selector
  ));
  if (duplicateName) {
    status.textContent = `字段名称“${name}”已存在，请使用其他名称。`;
    field('referenceName').focus();
    return;
  }
  const existing = editingPageReferences.find((reference) => reference.selector === pendingPickerResult?.selector);
  const reference = existing || { name, selector: pendingPickerResult.selector };
  reference.name = name;
  // 用本次 picker 采集的指纹（可能为空）刷新降级信息。
  if (pendingPickerResult.fallback) reference.fallback = pendingPickerResult.fallback;
  if (!existing) editingPageReferences.push(reference);
  promptEditor().querySelectorAll<HTMLElement>('.prompt-tag').forEach((tag) => {
    if (tag.dataset.selector === reference.selector) {
      const label = tag.querySelector<HTMLElement>('.prompt-tag-label');
      if (label) label.textContent = name;
    }
  });
  insertPromptReference(reference);
  status.textContent = `已添加字段“${name}”。`;
  pendingPickerResult = null;
  document.querySelector<HTMLElement>('.reference-name-form')!.hidden = true;
}

function cancelPickedElement(): void {
  pendingPickerResult = null;
  promptInsertionRange = null;
  document.querySelector<HTMLElement>('.reference-name-form')!.hidden = true;
  document.querySelector<HTMLElement>('.picker-status')!.textContent = '已取消添加字段。';
}

async function submitAction(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!state || !activeGroup) return;
  syncPromptValue();
  const prompt = field('prompt').value.trim();
  if (!prompt) {
    const warning = document.querySelector<HTMLElement>('.warning')!;
    warning.hidden = false;
    warning.textContent = '请输入 Prompt。';
    promptEditor().focus();
    return;
  }
  const usedPageReferences = editingPageReferences.filter((reference) => (
    prompt.includes(selectorToken(reference.selector)) || prompt.includes(`{page:${reference.name}}`)
  ));
  const isPolish = editingAction?.id === POLISH_ID;
  const action: StoredAction = {
    id: isPolish ? POLISH_ID : editingAction?.id || crypto.randomUUID(),
    name: isPolish ? '润色' : field('name').value.trim(),
    prompt,
    pageReferences: usedPageReferences.map((reference) => ({ ...reference })),
  };
  try {
    if (isPolish) {
      await savePolishAction(action.prompt, action.pageReferences);
    } else {
      const target: ElementTarget = {
        kind: field('targetKind').value as ElementTarget['kind'],
        value: field('targetValue').value.trim(),
      };
      const group: StoredActionGroup = {
        url: field('urlPattern').value.trim(),
        selector: targetToSelector(target),
        actions: [...activeGroup.actions.filter((item) => item.id !== action.id), action],
        pageName: field('pageName').value.trim(),
        fieldName: field('fieldName').value.trim(),
      };
      await saveActionGroup(group, activeGroup);
      activeGroup = group;
    }
    closeForm();
    await renderActions();
  } catch (error) {
    const warning = document.querySelector<HTMLElement>('.warning')!;
    warning.hidden = false;
    warning.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function removeAction(action: StoredAction): Promise<void> {
  if (!window.confirm(`确定删除动作“${action.name}”吗？`)) return;
  await deleteAction(action.id);
  if (activeGroup) activeGroup.actions = activeGroup.actions.filter((item) => item.id !== action.id);
  await renderActions();
}

async function resetPolish(): Promise<void> {
  await resetPolishAction();
  setPromptValue(DEFAULT_POLISH_PROMPT);
  closeForm();
  await renderActions();
}

async function loadState(value: unknown): Promise<void> {
  state = value as EditorState | undefined || null;
  if (!state) {
    void showListForCurrentTab();
    return;
  }
  view = 'edit';
  activeGroup = state.group
    ? { ...state.group, actions: state.group.actions.map((action) => ({ ...action })) }
    : {
      url: state.url,
      selector: targetToSelector(state.target),
      actions: [],
      pageName: state.pageName,
      fieldName: state.fieldName,
    };
  render();
  const actionId = state.actionId;
  if (actionId) {
    const action = actionId === POLISH_ID
      ? mergePolishAction(await getActionGroups())[0]
      : activeGroup.actions.find((item) => item.id === actionId);
    if (action) openForm(action);
  }
}

async function init(): Promise<void> {
  // ✦ 在当前标签页打开时保留深链；否则以列表为主页跟随当前标签页。
  const { editorState } = await chrome.storage.session.get('editorState');
  const stored = editorState as EditorState | undefined;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (stored && stored.tabId !== undefined && stored.tabId === tab?.id) {
    await loadState(stored);
  } else {
    await showListForCurrentTab();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session' || !changes.editorState) return;
    const newValue = changes.editorState.newValue as EditorState | undefined;
    if (!newValue) return;
    // ✦ 打开：记录深链以在 tab 事件竞态中收敛到编辑页，并立即切到编辑视图。
    pendingDeepLink = newValue;
    void loadState(newValue);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && view === 'list') void showListForCurrentTab();
  });
  chrome.tabs.onActivated.addListener(() => {
    void showListForCurrentTab();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
      if (activeTab?.id === tabId) void showListForCurrentTab();
    });
  });
}

void init().catch((error) => {
  app.innerHTML = `<p class="error">${error instanceof Error ? error.message : String(error)}</p>`;
});
