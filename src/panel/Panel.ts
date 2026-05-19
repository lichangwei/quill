import type { EnhanceRequest, EnhanceResponse } from '../types';
import { getFieldLabel, getFieldContent, fillField } from '../content/filler';

const PANEL_ID = 'quill-panel';

const PANEL_HTML = `
<div id="quill-panel-inner">
  <div class="quill-header">
    <span class="quill-title">✦ Quill</span>
    <button class="quill-close" title="关闭">✕</button>
  </div>
  <div class="quill-templates">
    <button data-template="polish">润色</button>
    <button data-template="translate">翻译</button>
    <button data-template="shorten">缩写</button>
    <button data-template="expand">扩写</button>
  </div>
  <div class="quill-result" style="display:none">
    <div class="quill-result-text"></div>
    <div class="quill-actions">
      <button class="quill-accept">接受</button>
      <button class="quill-retry">重试</button>
      <button class="quill-cancel">取消</button>
    </div>
  </div>
  <div class="quill-loading" style="display:none">
    <span>生成中...</span>
  </div>
  <div class="quill-error" style="display:none"></div>
</div>
`;

const PANEL_CSS = `
#quill-panel-inner {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12);
  width: 220px;
  overflow: hidden;
  color: #333;
}
.quill-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f7f7f8;
  border-bottom: 1px solid #e8e8e8;
}
.quill-title {
  font-weight: 600;
  font-size: 13px;
  color: #6c47ff;
}
.quill-close {
  background: none;
  border: none;
  cursor: pointer;
  color: #999;
  font-size: 12px;
  padding: 0;
  line-height: 1;
}
.quill-close:hover { color: #333; }
.quill-templates {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 10px;
}
.quill-templates button {
  padding: 6px 0;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fafafa;
  cursor: pointer;
  font-size: 12px;
  color: #444;
  transition: all 0.15s;
}
.quill-templates button:hover {
  background: #6c47ff;
  color: #fff;
  border-color: #6c47ff;
}
.quill-result {
  padding: 10px;
}
.quill-result-text {
  font-size: 12px;
  line-height: 1.5;
  color: #333;
  background: #f7f7f8;
  border-radius: 6px;
  padding: 8px;
  max-height: 120px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.quill-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.quill-actions button {
  flex: 1;
  padding: 5px 0;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
  cursor: pointer;
  font-size: 12px;
  background: #fafafa;
  color: #444;
  transition: all 0.15s;
}
.quill-accept {
  background: #6c47ff !important;
  color: #fff !important;
  border-color: #6c47ff !important;
}
.quill-accept:hover { opacity: 0.85; }
.quill-retry:hover, .quill-cancel:hover { background: #f0f0f0 !important; }
.quill-loading {
  padding: 12px;
  text-align: center;
  color: #999;
  font-size: 12px;
}
.quill-error {
  padding: 10px;
  color: #e53e3e;
  font-size: 12px;
  line-height: 1.4;
}
`;

export class QuillPanel {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private targetEl: HTMLInputElement | HTMLTextAreaElement | null = null;
  private lastTemplate: string = 'polish';
  private lastResult: string = '';

  constructor() {
    this.host = document.createElement('div');
    this.host.id = PANEL_ID;
    Object.assign(this.host.style, {
      position: 'fixed',
      zIndex: '2147483647',
      display: 'none',
    });
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    this.shadow.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = PANEL_HTML;
    this.shadow.appendChild(wrapper);

    document.body.appendChild(this.host);
    this.bindEvents();
  }

  private bindEvents() {
    // 模板按钮
    this.shadow.querySelectorAll('[data-template]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const template = (btn as HTMLElement).dataset.template!;
        this.lastTemplate = template;
        this.runEnhance(template);
      });
    });

    // 接受
    this.shadow.querySelector('.quill-accept')!.addEventListener('click', () => {
      if (this.targetEl && this.lastResult) {
        fillField(this.targetEl, this.lastResult);
      }
      this.hide();
    });

    // 重试
    this.shadow.querySelector('.quill-retry')!.addEventListener('click', () => {
      this.runEnhance(this.lastTemplate);
    });

    // 取消
    this.shadow.querySelector('.quill-cancel')!.addEventListener('click', () => {
      this.hide();
    });

    // 关闭
    this.shadow.querySelector('.quill-close')!.addEventListener('click', () => {
      this.hide();
    });

    // 点击面板外关闭
    document.addEventListener('mousedown', (e) => {
      if (this.host.style.display !== 'none' && !this.host.contains(e.target as Node)) {
        this.hide();
      }
    });
  }

  private async runEnhance(template: string) {
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

    const req: EnhanceRequest = { template: template as EnhanceRequest['template'], context };
    chrome.runtime.sendMessage({ type: 'ENHANCE_TEXT', payload: req }, (res: EnhanceResponse) => {
      if (chrome.runtime.lastError) {
        this.showError(chrome.runtime.lastError.message || '通信错误');
        return;
      }
      if (res.error) {
        this.showError(res.error);
      } else if (res.result) {
        this.lastResult = res.result;
        this.showResult(res.result);
      }
    });
  }

  private showLoading() {
    this.shadow.querySelector<HTMLElement>('.quill-templates')!.style.display = 'grid';
    this.shadow.querySelector<HTMLElement>('.quill-result')!.style.display = 'none';
    this.shadow.querySelector<HTMLElement>('.quill-loading')!.style.display = 'block';
    this.shadow.querySelector<HTMLElement>('.quill-error')!.style.display = 'none';
  }

  private showResult(text: string) {
    this.shadow.querySelector<HTMLElement>('.quill-loading')!.style.display = 'none';
    this.shadow.querySelector<HTMLElement>('.quill-error')!.style.display = 'none';
    const resultEl = this.shadow.querySelector<HTMLElement>('.quill-result')!;
    resultEl.style.display = 'block';
    this.shadow.querySelector<HTMLElement>('.quill-result-text')!.textContent = text;
  }

  private showError(msg: string) {
    this.shadow.querySelector<HTMLElement>('.quill-loading')!.style.display = 'none';
    this.shadow.querySelector<HTMLElement>('.quill-result')!.style.display = 'none';
    const errEl = this.shadow.querySelector<HTMLElement>('.quill-error')!;
    errEl.style.display = 'block';
    if (msg.includes('API Key')) {
      errEl.innerHTML = '';
      const text = document.createElement('span');
      text.textContent = '⚠ 请先配置 API Key：';
      const link = document.createElement('a');
      link.textContent = '打开设置页';
      link.href = '#';
      link.style.cssText = 'color:#3182ce;text-decoration:underline;cursor:pointer;margin-left:4px;';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      });
      errEl.appendChild(text);
      errEl.appendChild(link);
    } else {
      errEl.textContent = `⚠ ${msg}`;
    }
  }

  show(target: HTMLInputElement | HTMLTextAreaElement, anchorRect: DOMRect) {
    this.targetEl = target;
    this.lastResult = '';

    // 重置面板状态
    this.shadow.querySelector<HTMLElement>('.quill-templates')!.style.display = 'grid';
    this.shadow.querySelector<HTMLElement>('.quill-result')!.style.display = 'none';
    this.shadow.querySelector<HTMLElement>('.quill-loading')!.style.display = 'none';
    this.shadow.querySelector<HTMLElement>('.quill-error')!.style.display = 'none';

    this.host.style.display = 'block';

    // 定位：优先显示在输入框右侧，空间不足则显示在下方
    const panelWidth = 220;
    const margin = 6;
    let left = anchorRect.right + margin;
    let top = anchorRect.top;

    if (left + panelWidth > window.innerWidth) {
      left = anchorRect.left;
      top = anchorRect.bottom + margin;
    }

    this.host.style.left = `${Math.max(0, left)}px`;
    this.host.style.top = `${Math.max(0, top)}px`;
  }

  hide() {
    this.host.style.display = 'none';
    this.targetEl = null;
  }
}
