// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readSelectedElement } from './reader';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('readSelectedElement', () => {
  it('主 selector 命中时直接读取值', () => {
    document.body.innerHTML = '<input id="email" value="a@b.com">';
    expect(readSelectedElement('#email')).toEqual({ found: true, value: 'a@b.com' });
  });

  it('主 selector 失效且无指纹时返回未找到', () => {
    document.body.innerHTML = '<input id="email" value="a@b.com">';
    expect(readSelectedElement('#gone')).toEqual({ found: false, value: '' });
  });

  it('主 selector 失效时用指纹降级命中', () => {
    // selector 里的 id 变了，但 data-testid 仍在。
    document.body.innerHTML = '<input id="new-id" data-testid="email-field" value="x@y.com">';
    const result = readSelectedElement('#old-id', {
      tagName: 'input',
      attributes: { 'data-testid': 'email-field' },
    });
    expect(result).toEqual({ found: true, value: 'x@y.com' });
  });

  it('selector 语法非法时用指纹全局兜底', () => {
    document.body.innerHTML = '<div data-testid="target">内容文本</div>';
    const result = readSelectedElement('[[[bad', {
      tagName: 'div',
      attributes: { 'data-testid': 'target' },
    });
    expect(result).toEqual({ found: true, value: '内容文本' });
  });

  it('指纹也无法命中时返回未找到', () => {
    document.body.innerHTML = '<input value="x">';
    const result = readSelectedElement('#gone', {
      tagName: 'input',
      attributes: { 'data-testid': 'missing' },
    });
    expect(result).toEqual({ found: false, value: '' });
  });
});
