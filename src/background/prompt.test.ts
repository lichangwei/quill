import { describe, expect, it } from 'vitest';
import { buildPrompt } from './prompt';

const context = { pageTitle: '测试页', fieldLabel: '评论', content: '原始内容' };

describe('buildPrompt', () => {
  it('替换所有 content 占位符', () => {
    expect(buildPrompt('改写：{content}\n复核：{content}', context)).toBe(
      '当前页面标题：测试页\n当前字段：评论\n要求：只返回结果，不要任何解释。\n\n改写：原始内容\n复核：原始内容'
    );
  });

  it('没有占位符时在 prompt 后追加内容', () => {
    expect(buildPrompt('请精简', context)).toBe(
      '当前页面标题：测试页\n当前字段：评论\n要求：只返回结果，不要任何解释。\n\n请精简\n\n原始内容'
    );
  });

  it('页面引用动作不追加空的当前字段内容', () => {
    expect(buildPrompt('根据文章正文生成关键字', { ...context, content: '' })).toBe(
      '当前页面标题：测试页\n当前字段：评论\n要求：只返回结果，不要任何解释。\n\n根据文章正文生成关键字'
    );
  });
});
