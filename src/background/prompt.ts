import * as Types from '../types';

export function buildPrompt(
  prompt: string,
  context: Types.EnhanceRequest['context'],
  systemPrompt?: string
): string {
  const instruction = prompt.includes('{content}')
    ? prompt.replaceAll('{content}', context.content)
    : context.content
      ? `${prompt}\n\n${context.content}`
      : prompt;
  const formatInstruction = context.contentFormat === 'html'
    ? '当前字段是 HTML 富文本。请返回可直接插入 contenteditable 的 HTML，只使用内联 style 属性，不要 Markdown 代码块或解释。'
    : '只返回结果，不要任何解释。';
  const systemSection = systemPrompt?.trim()
    ? `系统级要求（优先级最高，必须始终遵守）：${systemPrompt.trim()}\n\n`
    : '';
  return `${systemSection}当前页面标题：${context.pageTitle}\n当前字段：${context.fieldLabel}\n要求：${formatInstruction}\n\n${instruction}`;
}
