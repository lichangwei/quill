import { describe, expect, it } from 'vitest';
import { PAGE_FIELD_NOT_FOUND, buildPageFieldPrompt, buildPrompt } from './prompt';

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

  it('页面引用动作不追加空的当前字段内容', () => {
    expect(buildPrompt('根据文章正文生成关键字', { ...context, content: '' })).toBe(
      '页面：测试页\n字段：评论\n\n根据文章正文生成关键字'
    );
  });

  it('构建不依赖 tool calling 的页面字段读取 prompt', () => {
    const prompt = buildPageFieldPrompt({
      description: '赠送对象',
      pageTitle: '员工激励',
      pageUrl: 'https://example.com',
      pageContent: '[1]<input value=张三 />',
    });
    expect(prompt).toContain('“赠送对象”');
    expect(prompt).toContain('[1]<input value=张三 />');
    expect(prompt).toContain(PAGE_FIELD_NOT_FOUND);
  });
});
