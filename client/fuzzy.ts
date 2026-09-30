export type PromptRecord = {
  id: string;
  agentId: string;
  agentLabel: string;
  text: string;
  sequence: number;
  createdAt: string | null;
};

export type RankedPrompt = PromptRecord & { score: number };

function normalise(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function isWordStart(value: string, index: number): boolean {
  return index === 0 || /[\s\-_/.]/.test(value[index - 1] ?? "");
}

function promptTime(prompt: PromptRecord): number {
  if (!prompt.createdAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const time = Date.parse(prompt.createdAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function comparePromptRecency(left: PromptRecord, right: PromptRecord): number {
  const leftTime = promptTime(left);
  const rightTime = promptTime(right);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.sequence - right.sequence;
}

function deduplicatePrompts(prompts: readonly PromptRecord[]): PromptRecord[] {
  const unique = new Map<string, PromptRecord>();
  for (const prompt of prompts) {
    const key = normalise(prompt.text);
    const existing = unique.get(key);
    if (!existing || comparePromptRecency(prompt, existing) > 0) {
      unique.set(key, prompt);
    }
  }
  return [...unique.values()];
}

function fuzzyScore(query: string, candidate: string): number | null {
  const needle = normalise(query);
  const haystack = normalise(candidate);

  if (!needle) {
    return 0;
  }

  const exactIndex = haystack.indexOf(needle);
  if (exactIndex >= 0) {
    const wordStartBonus = isWordStart(haystack, exactIndex) ? 120 : 0;
    return 1_000 + wordStartBonus + needle.length / Math.max(haystack.length, 1) - exactIndex / 10_000;
  }

  let queryIndex = 0;
  let previousMatch = -1;
  let score = 0;

  for (let candidateIndex = 0; candidateIndex < haystack.length && queryIndex < needle.length; candidateIndex += 1) {
    if (haystack[candidateIndex] !== needle[queryIndex]) {
      continue;
    }

    const atWordStart = isWordStart(haystack, candidateIndex);
    const gap = previousMatch < 0 ? candidateIndex : candidateIndex - previousMatch - 1;
    score += (atWordStart ? 18 : 5) - gap;
    previousMatch = candidateIndex;
    queryIndex += 1;
  }

  return queryIndex === needle.length ? 500 + score - haystack.length / 100 : null;
}

export function rankPrompts(
  prompts: readonly PromptRecord[],
  query: string,
  limit = 30,
): RankedPrompt[] {
  return deduplicatePrompts(prompts)
    .map((prompt) => {
      const score = fuzzyScore(query, prompt.text);
      return score === null ? null : { ...prompt, score };
    })
    .filter((prompt): prompt is RankedPrompt => prompt !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return -comparePromptRecency(left, right);
    })
    .slice(0, limit);
}
