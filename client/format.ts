export function formatPrompt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
