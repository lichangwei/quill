import type { ElementFingerprint } from '../types';

// 采集进指纹的稳定语义属性，与 selector 生成端信任的属性保持一致。
const FINGERPRINT_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-id', 'name', 'role', 'type', 'aria-label', 'placeholder'];
const MAX_TEXT = 80;

function elementText(el: Element): string {
  const text = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, MAX_TEXT);
}

/**
 * 采集元素指纹，供主 selector 失效时降级匹配使用。
 * 无任何可用信号时返回 undefined，避免存储空指纹。
 */
export function captureFingerprint(el: Element): ElementFingerprint | undefined {
  const attributes: Record<string, string> = {};
  for (const name of FINGERPRINT_ATTRS) {
    const value = el.getAttribute(name)?.trim();
    if (value) attributes[name] = value;
  }
  const text = elementText(el);
  const fingerprint: ElementFingerprint = { tagName: el.tagName.toLowerCase() };
  if (Object.keys(attributes).length) fingerprint.attributes = attributes;
  if (text) fingerprint.text = text;
  // 只有 tagName 太弱，不足以定位，视为无指纹。
  return fingerprint.attributes || fingerprint.text ? fingerprint : undefined;
}

function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 按指纹在 root 内降级查找元素。
 * 策略：属性组合唯一命中优先；否则在候选中按 tagName + 文本匹配择一。
 */
export function matchByFingerprint(fingerprint: ElementFingerprint | undefined, root: ParentNode): Element | null {
  if (!fingerprint) return null;
  const { tagName, attributes, text } = fingerprint;

  // 1. 稳定属性：先试全属性组合，再退到每个单属性，覆盖任意一个属性失效的情况。
  if (attributes) {
    const entries = Object.entries(attributes);
    const combos = entries.length > 1
      ? [entries, ...entries.map((entry) => [entry])]
      : [entries];
    for (const combo of combos) {
      const selector = (tagName || '*') + combo
        .map(([name, value]) => `[${name}="${escapeAttr(value)}"]`).join('');
      let matches: Element[];
      try {
        matches = Array.from(root.querySelectorAll(selector));
      } catch {
        continue;
      }
      if (matches.length === 1) return matches[0];
      // 多个候选时用文本消歧。
      if (matches.length > 1 && text) {
        const byText = matches.find((el) => elementText(el) === text);
        if (byText) return byText;
      }
    }
  }

  // 2. 仅靠 tagName + 文本：全等优先，退化到包含匹配，且要求候选唯一以避免误配。
  if (tagName && text) {
    const candidates = Array.from(root.querySelectorAll(tagName));
    const exact = candidates.filter((el) => elementText(el) === text);
    if (exact.length === 1) return exact[0];
    const partial = candidates.filter((el) => elementText(el).includes(text));
    if (partial.length === 1) return partial[0];
  }

  return null;
}
