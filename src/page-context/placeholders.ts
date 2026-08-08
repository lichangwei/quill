const PAGE_REFERENCE_PATTERN = /\{page:([^{}]+)\}/g;
const SELECTOR_REFERENCE_PATTERN = /\{selector:([^{}]+)\}/g;

export function getPageReferences(prompt: string): string[] {
  const references = new Set<string>();
  for (const match of prompt.matchAll(PAGE_REFERENCE_PATTERN)) {
    const description = match[1].trim();
    if (description) references.add(description);
  }
  for (const match of prompt.matchAll(SELECTOR_REFERENCE_PATTERN)) {
    const selector = match[1].trim();
    if (selector) references.add(`selector:${selector}`);
  }
  return [...references];
}

export async function resolvePageReferences(
  prompt: string,
  readPageContent: (description: string, selector?: string) => Promise<string>,
): Promise<string> {
  const contents = new Map<string, string>();
  const descriptions = [...prompt.matchAll(PAGE_REFERENCE_PATTERN)].map((match) => match[1].trim()).filter(Boolean);
  for (const description of new Set(descriptions)) {
    contents.set(description, await readPageContent(description));
  }
  const selectors = [...prompt.matchAll(SELECTOR_REFERENCE_PATTERN)].map((match) => match[1].trim()).filter(Boolean);
  for (const selector of new Set(selectors)) {
    contents.set(`selector:${selector}`, await readPageContent('', selector));
  }
  return prompt.replace(PAGE_REFERENCE_PATTERN, (reference, rawDescription: string) => (
    contents.get(rawDescription.trim()) ?? reference
  )).replace(SELECTOR_REFERENCE_PATTERN, (reference, rawSelector: string) => (
    contents.get(`selector:${rawSelector.trim()}`) ?? reference
  ));
}
