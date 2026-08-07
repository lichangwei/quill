import { describe, expect, it, vi } from 'vitest';
import { getPageReferences, resolvePageReferences } from './placeholders';

describe('page references', () => {
  it('extracts trimmed unique descriptions', () => {
    expect(getPageReferences('根据 {page:文章内容} 和 {page: 文章内容 } 生成摘要')).toEqual(['文章内容']);
  });

  it('resolves every page reference', async () => {
    const read = vi.fn(async (description: string) => `${description}的值`);
    const result = await resolvePageReferences(
      '根据 {page: 文章内容 } 生成 {page:关键字要求}',
      read,
    );

    expect(result).toBe('根据 文章内容的值 生成 关键字要求的值');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('leaves ordinary prompts unchanged', async () => {
    const read = vi.fn();
    expect(await resolvePageReferences('润色 {content}', read)).toBe('润色 {content}');
    expect(read).not.toHaveBeenCalled();
  });
});
