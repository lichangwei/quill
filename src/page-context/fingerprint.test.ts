// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { captureFingerprint, matchByFingerprint } from './fingerprint';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('captureFingerprint', () => {
  it('采集稳定属性、tagName 与文本', () => {
    document.body.innerHTML = '<button data-testid="save" aria-label="保存">保存按钮</button>';
    const fingerprint = captureFingerprint(document.querySelector('button')!);
    expect(fingerprint).toEqual({
      tagName: 'button',
      attributes: { 'data-testid': 'save', 'aria-label': '保存' },
      text: '保存按钮',
    });
  });

  it('截断过长文本', () => {
    const long = 'a'.repeat(200);
    document.body.innerHTML = `<div>${long}</div>`;
    const fingerprint = captureFingerprint(document.querySelector('div')!);
    expect(fingerprint?.text?.length).toBe(80);
  });

  it('无稳定属性也无文本时返回 undefined', () => {
    document.body.innerHTML = '<div></div>';
    expect(captureFingerprint(document.querySelector('div')!)).toBeUndefined();
  });
});

describe('matchByFingerprint', () => {
  it('undefined 指纹返回 null', () => {
    expect(matchByFingerprint(undefined, document)).toBeNull();
  });

  it('按稳定属性唯一命中', () => {
    document.body.innerHTML = '<input data-testid="email"><input data-testid="phone">';
    const el = matchByFingerprint({ tagName: 'input', attributes: { 'data-testid': 'phone' } }, document);
    expect(el).toBe(document.querySelector('[data-testid="phone"]'));
  });

  it('属性命中多个时用文本消歧', () => {
    document.body.innerHTML = '<button name="act">保存</button><button name="act">取消</button>';
    const el = matchByFingerprint({ tagName: 'button', attributes: { name: 'act' }, text: '取消' }, document);
    expect(el).toBe(document.querySelectorAll('button')[1]);
  });

  it('无属性时靠 tagName + 文本全等匹配', () => {
    document.body.innerHTML = '<span>其他</span><span>目标文本</span>';
    const el = matchByFingerprint({ tagName: 'span', text: '目标文本' }, document);
    expect(el).toBe(document.querySelectorAll('span')[1]);
  });

  it('文本匹配到多个候选时不误配', () => {
    document.body.innerHTML = '<p>重复</p><p>重复</p>';
    expect(matchByFingerprint({ tagName: 'p', text: '重复' }, document)).toBeNull();
  });

  it('部分属性失效时降级到较少属性组合', () => {
    // 存储时有两个属性，恢复时 name 变了，只剩 data-id 仍可定位。
    document.body.innerHTML = '<input data-id="u1" name="changed">';
    const el = matchByFingerprint(
      { tagName: 'input', attributes: { 'data-id': 'u1', name: 'original' } },
      document,
    );
    expect(el).toBe(document.querySelector('[data-id="u1"]'));
  });
});
