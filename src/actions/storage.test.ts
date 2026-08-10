// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import * as Types from '../types';
import {
  DEFAULT_POLISH_ACTION,
  POLISH_ID,
  buildEditorState,
  countTargetMatches,
  elementMatches,
  generateElementTarget,
  getMatchingActions,
  mergePolishAction,
  normalizeActionGroups,
  urlMatches,
} from './storage';

describe('urlMatches', () => {
  it('空规则匹配任意 URL', () => {
    expect(urlMatches('', 'https://example.com/path')).toBe(true);
  });

  it('支持通配符并转义其他正则字符', () => {
    expect(urlMatches('https://example.com/a?x=*', 'https://example.com/a?x=1.2')).toBe(true);
    expect(urlMatches('https://example.com/a?x=*', 'https://exampleXcom/a?x=1')).toBe(false);
  });

  it('要求完整 URL 匹配', () => {
    expect(urlMatches('https://example.com', 'https://example.com/path')).toBe(false);
  });
});

describe('动作合并与匹配', () => {
  it('缺少覆盖记录时注入默认润色并置顶', () => {
    expect(mergePolishAction([])).toEqual([DEFAULT_POLISH_ACTION]);
  });

  it('只使用润色覆盖记录的 prompt', () => {
    const merged = mergePolishAction([{
      url: '',
      selector: '',
      actions: [{ id: POLISH_ID, name: '错误名称', prompt: '自定义 {content}' }],
    }]);
    expect(merged[0]).toEqual({ ...DEFAULT_POLISH_ACTION, prompt: '自定义 {content}' });
  });

  it('将旧扁平动作按 URL 和 selector 迁移成分组结构', () => {
    expect(normalizeActionGroups([
      {
        id: 'translate', name: '翻译', prompt: 'translate',
        urlPattern: 'https://example.com/*', target: { kind: 'id', value: 'editor' },
      },
      {
        id: 'shorten', name: '缩写', prompt: 'shorten',
        urlPattern: 'https://example.com/*', target: { kind: 'id', value: 'editor' },
      },
    ])).toEqual([{
      url: 'https://example.com/*',
      selector: '#editor',
      actions: [
        { id: 'translate', name: '翻译', prompt: 'translate' },
        { id: 'shorten', name: '缩写', prompt: 'shorten' },
      ],
    }]);
  });

  it('按 URL 与当前元素同时过滤，润色始终匹配', () => {
    document.body.innerHTML = '<textarea id="editor"></textarea><textarea id="other"></textarea>';
    const editor = document.querySelector('#editor')!;
    const custom: Types.StoredAction = {
      id: 'custom', name: '翻译', prompt: 'translate',
    };
    const groups: Types.StoredActionGroup[] = [{
      url: 'https://example.com/*', selector: '#editor', actions: [custom],
    }];
    expect(getMatchingActions(groups, 'https://example.com/page', editor)).toEqual([DEFAULT_POLISH_ACTION, custom]);
    expect(getMatchingActions(groups, 'https://other.example/page', editor)).toEqual([DEFAULT_POLISH_ACTION]);
    expect(getMatchingActions(groups, 'https://example.com/page', document.querySelector('#other')!)).toEqual([DEFAULT_POLISH_ACTION]);
  });

  it('生成与当前元素匹配的侧边栏状态', () => {
    document.body.innerHTML = '<textarea id="editor"></textarea>';
    const group: Types.StoredActionGroup = {
      url: 'https://example.com/*',
      selector: '#editor',
      actions: [{ id: 'custom', name: '翻译', prompt: 'translate' }],
    };
    expect(buildEditorState([group], 'https://example.com/page', document.querySelector('textarea')!)).toEqual({
      url: group.url,
      selector: group.selector,
      target: { kind: 'id', value: 'editor' },
      group,
    });
  });
});

describe('元素目标', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('唯一 id 优先', () => {
    document.body.innerHTML = '<textarea id="message"></textarea>';
    expect(generateElementTarget(document.querySelector('textarea')!)).toEqual({ kind: 'id', value: 'message' });
  });

  it('用稳定属性生成唯一且指向正确元素的选择器', () => {
    document.body.innerHTML = '<input name="query" type="text"><input name="query" type="search">';
    const searchInput = document.querySelector('input[type="search"]')!;
    const target = generateElementTarget(searchInput);
    expect(target.kind).toBe('selector');
    expect(document.querySelectorAll(target.value)).toHaveLength(1);
    expect(document.querySelector(target.value)).toBe(searchInput);
    // 应基于语义属性，而非退化为 nth-of-type 位置路径。
    expect(target.value).not.toContain('nth-of-type');
  });

  it('优先使用 data-testid 而非易变 class', () => {
    document.body.innerHTML = '<button class="css-1a2b3c" data-testid="submit">提交</button>';
    const target = generateElementTarget(document.querySelector('button')!);
    expect(target.value).toContain('data-testid="submit"');
    expect(target.value).not.toContain('css-1a2b3c');
  });

  it('忽略框架自动生成的 id', () => {
    document.body.innerHTML = '<div id="ember123"><input name="email"></div>';
    const target = generateElementTarget(document.querySelector('input')!);
    expect(target.value).not.toContain('ember123');
    expect(document.querySelector(target.value)).toBe(document.querySelector('input'));
  });

  it('稳定属性不唯一时生成父级路径', () => {
    document.body.innerHTML = '<main><section><textarea></textarea><textarea></textarea></section></main>';
    const target = generateElementTarget(document.querySelectorAll('textarea')[1]);
    expect(target.kind).toBe('selector');
    expect(document.querySelectorAll(target.value)).toHaveLength(1);
    expect(document.querySelector(target.value)).toBe(document.querySelectorAll('textarea')[1]);
  });

  it('非法选择器不匹配且计数为零', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const target = { kind: 'selector' as const, value: '[' };
    expect(elementMatches(document.querySelector('textarea')!, target)).toBe(false);
    expect(countTargetMatches(target)).toBe(0);
  });
});
