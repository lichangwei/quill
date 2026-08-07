import type { EnhanceRequest } from '../types';

export function buildPrompt(prompt: string, context: EnhanceRequest['context']): string {
  const instruction = prompt.includes('{content}')
    ? prompt.replaceAll('{content}', context.content)
    : `${prompt}\n\n${context.content}`;
  return `页面：${context.pageTitle}\n字段：${context.fieldLabel}\n\n${instruction}`;
}
