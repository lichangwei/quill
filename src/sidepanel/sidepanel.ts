import type { EditorState, ElementTarget, StoredAction, StoredActionGroup } from '../types';
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
        <div class="field"><label>Prompt<textarea name="prompt" rows="7" required placeholder="{content} 表示当前输入框，{page:文章内容} 可读取页面字段"></textarea></label></div>
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
  const form = document.querySelector<HTMLFormElement>('#action-form')!;
  field('name').value = action?.name || '';
  field('name').disabled = action?.id === POLISH_ID;
  field('prompt').value = action?.prompt || '';
  document.querySelector<HTMLElement>('.reset')!.hidden = action?.id !== POLISH_ID;
  document.querySelector<HTMLElement>('.warning')!.hidden = true;
  form.hidden = false;
  field(action?.id === POLISH_ID ? 'prompt' : 'name').focus();
}

function closeForm(): void {
  const form = document.querySelector<HTMLFormElement>('#action-form');
  if (form) form.hidden = true;
  editingAction = null;
}

async function submitAction(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!state || !activeGroup) return;
  const isPolish = editingAction?.id === POLISH_ID;
  const action: StoredAction = {
    id: isPolish ? POLISH_ID : editingAction?.id || crypto.randomUUID(),
    name: isPolish ? '润色' : field('name').value.trim(),
    prompt: field('prompt').value.trim(),
  };
  try {
    if (isPolish) {
      await savePolishAction(action.prompt);
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
  field('prompt').value = DEFAULT_POLISH_PROMPT;
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
