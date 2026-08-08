// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fillField, getFieldContent, getFieldLabel } from './filler';

describe('contenteditable 字段', () => {
  it('读取可编辑区域的当前文本和字段名称', () => {
    document.body.innerHTML = '<div id="editor" contenteditable="true" aria-label="文章内容"><p>正文</p></div>';
    const editor = document.querySelector('#editor') as HTMLElement;

    expect(getFieldLabel(editor)).toBe('文章内容');
    expect(getFieldContent(editor)).toBe('<p>正文</p>');
  });

  it('回填文本并触发 input/change 事件', () => {
    document.body.innerHTML = '<div id="editor" contenteditable="true">旧内容</div>';
    const editor = document.querySelector('#editor') as HTMLElement;
    const onInput = vi.fn();
    const onChange = vi.fn();
    editor.addEventListener('input', onInput);
    editor.addEventListener('change', onChange);

    fillField(editor, '<p style="font-weight: bold">新内容</p>');

    expect(getFieldContent(editor)).toBe('<p style="font-weight: bold">新内容</p>');
    expect(onInput).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
  });
});
