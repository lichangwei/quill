/**
 * 采集输入框的字段标题
 * 优先级：aria-label > <label for="id"> > placeholder > name 属性
 */
export function getFieldLabel(el: HTMLInputElement | HTMLTextAreaElement): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  if (el.id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
    if (label) return label.textContent?.trim() || '';
  }

  // 尝试找最近的父级 label
  const closestLabel = el.closest('label');
  if (closestLabel) return closestLabel.textContent?.trim() || '';

  if (el.placeholder) return el.placeholder;
  if (el.name) return el.name;

  return '输入框';
}

/**
 * 获取输入框当前内容
 */
export function getFieldContent(el: HTMLInputElement | HTMLTextAreaElement): string {
  return el.value;
}

/**
 * 将结果回填到输入框，兼容 React/Vue 的受控组件
 */
export function fillField(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.focus();

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
