import type {
  EditorState,
  ElementPickerResult,
  ElementTarget,
  PageElementReference,
  StoredAction,
  StoredActionGroup,
} from '../types';
import {
  DEFAULT_POLISH_PROMPT,
  POLISH_ID,
  deleteAction,
  getActionGroups,
  mergePolishAction,
  resetPolishAction,
  saveActionGroup,
  savePolishAction,
  targetToSelector,
} from '../actions/storage';

const app = document.querySelector<HTMLElement>('#app')!;
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

function field(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.className = className;
  element.addEventListener('click', onClick);
  return element;
}

function render(): void {
  if (!state || !activeGroup) {
    app.innerHTML = '<p class="empty">请从页面上的 Quill 按钮打开动作编辑。</p>';
    return;
  }
  app.innerHTML = `
    <section class="section">
      <h2 class="section-title">绑定范围</h2>
      <div class="field"><label>URL 规则<input name="urlPattern" type="text" /></label></div>
      <div class="field"><label>元素类型<select name="targetKind"><option value="id">ID</option><option value="selector">CSS 选择器</option></select></label></div>
      <div class="field"><label>元素标识<input name="targetValue" type="text" /></label></div>
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

  field('urlPattern').value = activeGroup.url;
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
  if (token === '{content}') tag.dataset.token = token;
  else tag.dataset.selector = reference.selector;
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

function readElementValue(tabId: number, selector: string): Promise<{ found: boolean; value: string }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: 'READ_SELECTED_ELEMENT', selector }, (response?: { found?: boolean; value?: string }) => {
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
  const tooltip = ensureValueTooltip();
  const requestId = ++valueRequestId;
  tooltip.textContent = '正在读取左侧页面元素...';
  tooltip.hidden = false;
  positionValueTooltip(event);
  void getEditorTabId().then((tabId) => readElementValue(tabId, selector)).then((result) => {
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
    render();
    return;
  }
  activeGroup = state.group
    ? { ...state.group, actions: state.group.actions.map((action) => ({ ...action })) }
    : { url: state.url, selector: targetToSelector(state.target), actions: [] };
  render();
}

async function init(): Promise<void> {
  const result = await chrome.storage.session.get('editorState');
  await loadState(result.editorState);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'session' && changes.editorState) {
      void loadState(changes.editorState.newValue);
    }
  });
}

void init().catch((error) => {
  app.innerHTML = `<p class="error">${error instanceof Error ? error.message : String(error)}</p>`;
});
