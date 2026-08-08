import * as Types from '../types';

export function buildPrompt(prompt: string, context: Types.EnhanceRequest['context']): string {
  const instruction = prompt.includes('{content}')
    ? prompt.replaceAll('{content}', context.content)
    : context.content
      ? `${prompt}\n\n${context.content}`
      : prompt;
  return `当前页面标题：${context.pageTitle}\n当前字段：${context.fieldLabel}\n要求：只返回结果，不要任何解释。\n\n${instruction}`;
}
