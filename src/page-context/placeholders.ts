const PAGE_REFERENCE_PATTERN = /\{page:([^{}]+)\}/g;

export function getPageReferences(prompt: string): string[] {
  const references = new Set<string>();
  for (const match of prompt.matchAll(PAGE_REFERENCE_PATTERN)) {
    const description = match[1].trim();
    if (description) references.add(description);
  }
  return [...references];
}

export async function resolvePageReferences(
  prompt: string,
  readPageContent: (description: string) => Promise<string>,
): Promise<string> {
  const contents = new Map<string, string>();
  for (const description of getPageReferences(prompt)) {
    contents.set(description, await readPageContent(description));
  }
  return prompt.replace(PAGE_REFERENCE_PATTERN, (reference, rawDescription: string) => (
    contents.get(rawDescription.trim()) ?? reference
  ));
}
