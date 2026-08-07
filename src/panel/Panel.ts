import type { ElementTarget, EnhanceRequest, EnhanceResponse, StoredAction, StoredActionGroup } from '../types';
import { getFieldContent, getFieldLabel, fillField } from '../content/filler';
import {
  DEFAULT_POLISH_PROMPT,
  POLISH_ID,
  countSelectorMatches,
  deleteAction,
  generateElementTarget,
  getActionGroups,
  getMatchingActionGroup,
  getMatchingActions,
  mergePolishAction,
  resetPolishAction,
  saveActionGroup,
  savePolishAction,
  targetToSelector,
} from '../actions/storage';

const PANEL_ID = 'quill-panel';

const PANEL_HTML = `
<div id="quill-panel-inner">
  <div class="quill-header">
    <span class="quill-title">✦ Quill</span>
    <button type="button" class="quill-icon-button quill-close" title="关闭" aria-label="关闭">×</button>
  </div>
  <div class="quill-action-list"></div>
  <div class="quill-result" hidden>
    <div class="quill-result-text"></div>
    <div class="quill-result-actions">
      <button type="button" class="quill-primary quill-accept">接受</button>
      <button type="button" class="quill-retry">重试</button>
      <button type="button" class="quill-cancel">取消</button>
    </div>
  </div>
  <div class="quill-loading" hidden>生成中...</div>
  <div class="quill-error" hidden></div>
  <div class="quill-editor" hidden>
    <div class="quill-binding-fields">
      <label>URL 规则<input name="urlPattern" type="text" /></label>
      <label>元素类型
        <select name="targetKind">
          <option value="id">ID</option>
          <option value="selector">CSS 选择器</option>
        </select>
      </label>
      <label>元素标识<input name="targetValue" type="text" required /></label>
    </div>
    <div class="quill-editor-toolbar">
      <strong>动作</strong>
      <button type="button" class="quill-primary quill-new-action">新建动作</button>
    </div>
    <div class="quill-bound-actions"></div>
    <form class="quill-action-form" hidden>
      <input type="hidden" name="id" />
      <label>名称<input name="name" type="text" maxlength="40" required /></label>
      <label>Prompt<textarea name="prompt" rows="5" required placeholder="可用 {content} 表示输入框内容"></textarea></label>
      <div class="quill-form-warning" hidden></div>
      <div class="quill-form-actions">
        <button type="submit" class="quill-primary quill-save-action">保存</button>
        <button type="button" class="quill-reset-polish" hidden>恢复默认</button>
        <button type="button" class="quill-form-cancel">取消</button>
      </div>
    </form>
  </div>
</div>
`;

const PANEL_CSS = `
:host { color-scheme: light; }
* { box-sizing: border-box; letter-spacing: 0; }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }
#quill-panel-inner {
  width: 240px; overflow: hidden; color: #29272e; background: #fff;
  border: 1px solid #dddce2; border-radius: 8px; box-shadow: 0 8px 28px rgba(25,20,35,.18);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px;
}
#quill-panel-inner.editor-mode { width: min(440px, calc(100vw - 16px)); max-height: min(680px, calc(100vh - 16px)); overflow-y: auto; }
.quill-header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 9px 12px; background: #f7f7f8; border-bottom: 1px solid #e8e8e8; }
.quill-title { color: #6344d8; font-weight: 650; }
.quill-icon-button { width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: #76727d; font-size: 18px; line-height: 24px; }
.quill-icon-button:hover { color: #29272e; }
.quill-action-list { display: flex; flex-direction: column; gap: 6px; padding: 10px; }
.quill-action-button { width: 100%; min-height: 34px; padding: 7px 10px; overflow-wrap: anywhere; text-align: left; color: #38343e; background: #fafafa; border: 1px solid #dfdee4; border-radius: 6px; }
.quill-action-button:hover { color: #fff; background: #6344d8; border-color: #6344d8; }
.quill-result, .quill-error, .quill-editor { padding: 12px; }
.quill-result-text { max-height: 160px; overflow-y: auto; padding: 9px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; background: #f7f7f8; border-radius: 6px; }
.quill-result-actions, .quill-form-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
.quill-result-actions button, .quill-form-actions button, .quill-new-action { min-height: 32px; padding: 6px 11px; color: #45414a; background: #fff; border: 1px solid #d9d7de; border-radius: 6px; }
.quill-primary { color: #fff !important; background: #6344d8 !important; border-color: #6344d8 !important; }
.quill-loading { padding: 14px; text-align: center; color: #77727d; }
.quill-error { color: #c22f3d; line-height: 1.45; }
.quill-error a { margin-left: 4px; color: #246fc2; text-decoration: underline; }
.quill-binding-fields { padding-bottom: 12px; border-bottom: 1px solid #e2e0e6; }
.quill-editor-toolbar { display: flex; align-items: center; justify-content: space-between; margin: 14px 0 8px; }
.quill-bound-actions { display: flex; flex-direction: column; gap: 6px; }
.quill-bound-row { display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 5px 6px 5px 10px; border: 1px solid #e0dfe4; border-radius: 6px; }
.quill-bound-name { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.quill-bound-row button { padding: 5px 8px; color: #514c58; background: #fff; border: 1px solid #dedce2; border-radius: 5px; }
.quill-bound-row .quill-delete { color: #bd3040; }
.quill-empty { padding: 10px 0; color: #85808a; }
.quill-action-form { margin-top: 14px; padding-top: 14px; border-top: 1px solid #e2e0e6; }
.quill-editor label { display: block; margin-bottom: 10px; color: #46414b; font-weight: 600; }
.quill-editor input, .quill-editor textarea, .quill-editor select { width: 100%; margin-top: 5px; padding: 8px 9px; color: #29272e; background: #fff; border: 1px solid #d5d2da; border-radius: 6px; outline: none; }
.quill-action-form textarea { resize: vertical; line-height: 1.45; }
.quill-editor input:focus, .quill-editor textarea:focus, .quill-editor select:focus { border-color: #6344d8; }
.quill-action-form input:disabled { color: #77727d; background: #f4f3f5; }
.quill-form-warning { margin-top: 8px; padding: 8px; color: #8c5a00; background: #fff7df; border: 1px solid #edd28a; border-radius: 6px; }
`;

type TargetInput = HTMLInputElement | HTMLTextAreaElement;

export class QuillPanel {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private targetEl: TargetInput | null = null;
  private lastAction: StoredAction | null = null;
  private lastResult = '';
  private generatedTarget: ElementTarget | null = null;
  private activeGroup: StoredActionGroup | null = null;
  private forceSaveReady = false;

  constructor() {
    this.host = document.createElement('div');
    this.host.id = PANEL_ID;
    Object.assign(this.host.style, { position: 'fixed', zIndex: '2147483647', display: 'none' });
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    this.shadow.append(style);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = PANEL_HTML;
    this.shadow.append(wrapper);
    document.body.append(this.host);
    this.bindEvents();
  }

  private get inner(): HTMLElement {
    return this.shadow.querySelector('#quill-panel-inner') as HTMLElement;
  }

  private bindEvents(): void {
    this.shadow.querySelector('.quill-close')!.addEventListener('click', () => this.hide());
    this.shadow.querySelector('.quill-cancel')!.addEventListener('click', () => this.hide());
    this.shadow.querySelector('.quill-accept')!.addEventListener('click', () => {
      if (this.targetEl && this.lastResult) fillField(this.targetEl, this.lastResult);
      this.hide();
    });
    this.shadow.querySelector('.quill-retry')!.addEventListener('click', () => {
      if (this.lastAction) void this.runEnhance(this.lastAction);
    });
    this.shadow.querySelector('.quill-new-action')!.addEventListener('click', () => this.openActionForm());
    this.shadow.querySelector('.quill-form-cancel')!.addEventListener('click', () => this.closeActionForm());
    this.shadow.querySelector('.quill-reset-polish')!.addEventListener('click', () => void this.resetPolish());
    this.shadow.querySelector<HTMLFormElement>('.quill-action-form')!.addEventListener('submit', (event) => void this.submitAction(event));
    this.shadow.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('.quill-editor input, .quill-editor textarea, .quill-editor select')
      .forEach((field) => field.addEventListener('input', () => this.clearSaveWarning()));
    document.addEventListener('mousedown', (event) => {
      if (this.host.style.display !== 'none' && !this.host.contains(event.target as Node)) this.hide();
    });
  }

  async showActions(target: TargetInput, anchorRect: DOMRect): Promise<void> {
    this.prepare(target, false);
    try {
      const actions = getMatchingActions(await getActionGroups(), location.href, target);
      const list = this.shadow.querySelector<HTMLElement>('.quill-action-list')!;
      list.replaceChildren(...actions.map((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'quill-action-button';
        button.textContent = action.name;
        button.addEventListener('click', () => {
          this.lastAction = action;
          void this.runEnhance(action);
        });
        return button;
      }));
      this.showAt(anchorRect, 240);
    } catch (error) {
      this.showAt(anchorRect, 240);
      this.showError(this.errorMessage(error));
    }
  }

  async showEditor(target: TargetInput, anchorRect: DOMRect): Promise<void> {
    this.prepare(target, true);
    this.generatedTarget = generateElementTarget(target);
    this.showAt(anchorRect, 440);
    try {
      const groups = await getActionGroups();
      const matchedGroup = getMatchingActionGroup(groups, location.href, target);
      this.activeGroup = matchedGroup
        ? { ...matchedGroup, actions: matchedGroup.actions.map((action) => ({ ...action })) }
        : { url: location.href, selector: targetToSelector(this.generatedTarget), actions: [] };
      const displayTarget = this.activeGroup.selector === targetToSelector(this.generatedTarget)
        ? this.generatedTarget
        : { kind: 'selector' as const, value: this.activeGroup.selector };
      this.formField('urlPattern').value = this.activeGroup.url;
      this.formField('targetKind').value = displayTarget.kind;
      this.formField('targetValue').value = displayTarget.value;
      await this.renderBoundActions();
    } catch (error) {
      this.showError(this.errorMessage(error));
    }
  }

  private prepare(target: TargetInput, editor: boolean): void {
    this.targetEl = target;
    this.lastAction = null;
    this.lastResult = '';
    this.activeGroup = null;
    this.inner.classList.toggle('editor-mode', editor);
    this.shadow.querySelector<HTMLElement>('.quill-action-list')!.hidden = editor;
    this.shadow.querySelector<HTMLElement>('.quill-editor')!.hidden = !editor;
    this.shadow.querySelector<HTMLElement>('.quill-result')!.hidden = true;
    this.shadow.querySelector<HTMLElement>('.quill-loading')!.hidden = true;
    this.shadow.querySelector<HTMLElement>('.quill-error')!.hidden = true;
    this.closeActionForm();
  }

  private async renderBoundActions(): Promise<void> {
    if (!this.targetEl || !this.activeGroup) return;
    const container = this.shadow.querySelector<HTMLElement>('.quill-bound-actions')!;
    try {
      const actions = [
        ...mergePolishAction(await getActionGroups()),
        ...this.activeGroup.actions.filter((action) => action.id !== POLISH_ID),
      ];
      container.replaceChildren(...actions.map((action) => {
        const row = document.createElement('div');
        row.className = 'quill-bound-row';
        const name = document.createElement('span');
        name.className = 'quill-bound-name';
        name.textContent = action.name;
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '编辑';
        edit.addEventListener('click', () => this.openActionForm(action));
        row.append(name, edit);
        if (action.id !== POLISH_ID) {
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'quill-delete';
          remove.textContent = '删除';
          remove.addEventListener('click', () => void this.removeAction(action));
          row.append(remove);
        }
        return row;
      }));
    } catch (error) {
      container.textContent = this.errorMessage(error);
    }
  }

  private openActionForm(action?: StoredAction): void {
    if (!this.generatedTarget || !this.activeGroup) return;
    const form = this.shadow.querySelector<HTMLFormElement>('.quill-action-form')!;
    const isPolish = action?.id === POLISH_ID;
    this.formField('id').value = action?.id || '';
    this.formField('name').value = action?.name || '';
    this.formField('name').disabled = isPolish;
    this.formField('prompt').value = action?.prompt || '';
    this.shadow.querySelector<HTMLElement>('.quill-reset-polish')!.hidden = !isPolish;
    form.hidden = false;
    this.clearSaveWarning();
    this.formField(isPolish ? 'prompt' : 'name').focus();
  }

  private closeActionForm(): void {
    const form = this.shadow.querySelector<HTMLFormElement>('.quill-action-form');
    if (form) form.hidden = true;
    this.clearSaveWarning();
  }

  private formField(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
    return this.shadow.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  }

  private async submitAction(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!this.activeGroup) return;
    const id = this.formField('id').value;
    const isPolish = id === POLISH_ID;
    const target: ElementTarget = {
      kind: this.formField('targetKind').value as ElementTarget['kind'],
      value: this.formField('targetValue').value.trim(),
    };
    const selector = targetToSelector(target);
    if (!isPolish) {
      const matchCount = countSelectorMatches(selector);
      if (matchCount !== 1 && !this.forceSaveReady) {
        this.forceSaveReady = true;
        const warning = this.shadow.querySelector<HTMLElement>('.quill-form-warning')!;
        warning.hidden = false;
        warning.textContent = `该标识在当前页面命中 ${matchCount} 个元素。确认无误后可仍然保存。`;
        this.shadow.querySelector<HTMLButtonElement>('.quill-save-action')!.textContent = '仍然保存';
        return;
      }
    }

    const action: StoredAction = {
      id: isPolish ? POLISH_ID : id || crypto.randomUUID(),
      name: isPolish ? '润色' : this.formField('name').value.trim(),
      prompt: this.formField('prompt').value.trim(),
    };
    try {
      if (isPolish) {
        await savePolishAction(action.prompt);
      } else {
        const actions = this.activeGroup.actions.filter((item) => item.id !== action.id);
        const updatedGroup: StoredActionGroup = {
          url: this.formField('urlPattern').value.trim(),
          selector,
          actions: [...actions, action],
        };
        await saveActionGroup(updatedGroup, this.activeGroup);
        this.activeGroup = updatedGroup;
      }
      this.closeActionForm();
      await this.renderBoundActions();
    } catch (error) {
      this.showFormWarning(this.errorMessage(error));
    }
  }

  private async removeAction(action: StoredAction): Promise<void> {
    if (!window.confirm(`确定删除动作“${action.name}”吗？`)) return;
    try {
      await deleteAction(action.id);
      if (this.activeGroup) {
        this.activeGroup.actions = this.activeGroup.actions.filter((item) => item.id !== action.id);
      }
      this.closeActionForm();
      await this.renderBoundActions();
    } catch (error) {
      this.showFormWarning(this.errorMessage(error));
    }
  }

  private async resetPolish(): Promise<void> {
    try {
      await resetPolishAction();
      this.formField('prompt').value = DEFAULT_POLISH_PROMPT;
      this.closeActionForm();
      await this.renderBoundActions();
    } catch (error) {
      this.showFormWarning(this.errorMessage(error));
    }
  }

  private clearSaveWarning(): void {
    this.forceSaveReady = false;
    const warning = this.shadow.querySelector<HTMLElement>('.quill-form-warning');
    if (warning) {
      warning.hidden = true;
      warning.textContent = '';
    }
    const saveButton = this.shadow.querySelector<HTMLButtonElement>('.quill-save-action');
    if (saveButton) saveButton.textContent = '保存';
  }

  private showFormWarning(message: string): void {
    const warning = this.shadow.querySelector<HTMLElement>('.quill-form-warning')!;
    warning.hidden = false;
    warning.textContent = message;
  }

  private async runEnhance(action: StoredAction): Promise<void> {
    if (!this.targetEl) return;
    const context = {
      pageTitle: document.title,
      fieldLabel: getFieldLabel(this.targetEl),
      content: getFieldContent(this.targetEl),
    };
    if (!context.content.trim()) {
      this.showError('输入框内容为空');
      return;
    }
    this.showLoading();
    const request: EnhanceRequest = { prompt: action.prompt, context };
    chrome.runtime.sendMessage({ type: 'ENHANCE_TEXT', payload: request }, (response?: EnhanceResponse) => {
      if (chrome.runtime.lastError) {
        this.showError(chrome.runtime.lastError.message || '通信错误');
      } else if (!response) {
        this.showError('未收到后台响应');
      } else if (response.error) {
        this.showError(response.error);
      } else if (response.result) {
        this.lastResult = response.result;
        this.showResult(response.result);
      } else {
        this.showError('未生成结果');
      }
    });
  }

  private showLoading(): void {
    this.shadow.querySelector<HTMLElement>('.quill-action-list')!.hidden = false;
    this.shadow.querySelector<HTMLElement>('.quill-result')!.hidden = true;
    this.shadow.querySelector<HTMLElement>('.quill-loading')!.hidden = false;
    this.shadow.querySelector<HTMLElement>('.quill-error')!.hidden = true;
  }

  private showResult(text: string): void {
    this.shadow.querySelector<HTMLElement>('.quill-loading')!.hidden = true;
    this.shadow.querySelector<HTMLElement>('.quill-error')!.hidden = true;
    this.shadow.querySelector<HTMLElement>('.quill-result')!.hidden = false;
    this.shadow.querySelector<HTMLElement>('.quill-result-text')!.textContent = text;
  }

  private showError(message: string): void {
    this.shadow.querySelector<HTMLElement>('.quill-loading')!.hidden = true;
    this.shadow.querySelector<HTMLElement>('.quill-result')!.hidden = true;
    const error = this.shadow.querySelector<HTMLElement>('.quill-error')!;
    error.hidden = false;
    error.replaceChildren();
    if (message.includes('API Key')) {
      error.append(document.createTextNode('请先配置 API Key：'));
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = '打开设置页';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      });
      error.append(link);
    } else {
      error.textContent = message;
    }
  }

  private showAt(anchorRect: DOMRect, panelWidth: number): void {
    this.host.style.display = 'block';
    const margin = 6;
    let left = anchorRect.right + margin;
    let top = anchorRect.top;
    if (left + panelWidth > window.innerWidth) {
      left = Math.min(anchorRect.left, window.innerWidth - panelWidth - 8);
      top = anchorRect.bottom + margin;
    }
    const maxHeight = this.inner.classList.contains('editor-mode') ? Math.min(680, window.innerHeight - 16) : 240;
    if (top + maxHeight > window.innerHeight) top = Math.max(8, window.innerHeight - maxHeight - 8);
    this.host.style.left = `${Math.max(8, left)}px`;
    this.host.style.top = `${Math.max(8, top)}px`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  hide(): void {
    this.host.style.display = 'none';
    this.targetEl = null;
  }
}
