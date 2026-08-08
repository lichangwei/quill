/**
 * 采集输入框的字段标题
 * 优先级：aria-label > <label for="id"> > placeholder > name 属性
 */
export type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

export function isContentEditableTarget(el: EditableTarget): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const attribute = el.getAttribute('contenteditable');
  return el.isContentEditable || (attribute !== null && attribute.toLowerCase() !== 'false');
}

export function getFieldLabel(el: EditableTarget): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  if (el.id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
    if (label) return label.textContent?.trim() || '';
  }

  // 尝试找最近的父级 label
  const closestLabel = el.closest('label');
  if (closestLabel) return closestLabel.textContent?.trim() || '';

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder;
  const name = el.getAttribute('name');
  if (name) return name;

  return '输入框';
}

/**
 * 获取输入框当前内容
 */
export function getFieldContent(el: EditableTarget): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  if (isContentEditableTarget(el)) return el.innerHTML;
  return el.innerText || el.textContent || '';
}

/**
 * 将结果回填到输入框，兼容 React/Vue 的受控组件
 */
export function fillField(el: EditableTarget, value: string): void {
  el.focus();

  if (isContentEditableTarget(el)) {
    el.innerHTML = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;

  // 使用 Object.getOwnPropertyDescriptor 绕过 React 的合成事件拦截
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
