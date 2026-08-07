function normalizeLabel(value: string): string {
  return value.replace(/[\s*：:]/g, '').trim();
}

function textOf(element: Element): string {
  return ((element as HTMLElement).innerText || element.textContent || '').trim();
}

function controlValue(element: Element): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.type === 'password' ? '' : element.value.trim();
  }
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.selectedOptions).map((option) => option.text.trim()).filter(Boolean).join('、');
  }
  return textOf(element);
}

function contentValue(container: Element): string {
  const selectedItems = container.querySelectorAll(
    '.el-select__tags-text, .ant-select-selection-item, [class*="selection-item"], [class*="selected-value"]',
  );
  const selectedText = Array.from(selectedItems).map(textOf).filter(Boolean).join('、');
  if (selectedText) return selectedText;

  const controls = container.querySelectorAll('input, textarea, select, [contenteditable="true"]');
  for (const control of controls) {
    const value = controlValue(control);
    if (value) return value;
  }
  return textOf(container);
}

export function readLabeledField(description: string, root: ParentNode = document): string | null {
  const expected = normalizeLabel(description);
  if (!expected) return null;

  for (const label of root.querySelectorAll('label')) {
    if (normalizeLabel(textOf(label)) !== expected) continue;

    if (label instanceof HTMLLabelElement && label.htmlFor) {
      const control = document.getElementById(label.htmlFor);
      const value = control ? controlValue(control) : '';
      if (value) return value;
    }

    const sibling = label.nextElementSibling;
    if (sibling) {
      const value = contentValue(sibling);
      if (value) return value;
    }

    const formItem = label.closest('.el-form-item, .ant-form-item, .form-item, [class*="form-item"]');
    const content = formItem?.querySelector(
      '.el-form-item__content, .ant-form-item-control, .form-item__content, [class*="form-item-content"]',
    );
    if (content) {
      const value = contentValue(content);
      if (value) return value;
    }
  }
  return null;
}
