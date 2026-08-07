import { describe, expect, it } from 'vitest';
import { buildPrompt } from './prompt';

const context = { pageTitle: '测试页', fieldLabel: '评论', content: '原始内容' };

describe('buildPrompt', () => {
  it('替换所有 content 占位符', () => {
    expect(buildPrompt('改写：{content}\n复核：{content}', context)).toBe(
      '页面：测试页\n字段：评论\n\n改写：原始内容\n复核：原始内容'
    );
  });

  it('没有占位符时在 prompt 后追加内容', () => {
    expect(buildPrompt('请精简', context)).toBe(
      '页面：测试页\n字段：评论\n\n请精简\n\n原始内容'
    );
  });
});
