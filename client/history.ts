import type { PromptRecord } from "./fuzzy";

type RecordValue = Record<string, unknown>;

export type TimelineEntry = {
  item?: unknown;
  timestamp: string;
  seqStart?: number;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

function stringValue(record: RecordValue, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

export function promptText(item: unknown): string | null {
  if (!isRecord(item) || item.type !== "user_message") {
    return null;
  }

  const text = stringValue(item, "text");
  return text && text.trim() ? text : null;
}

/**
 * Pages are read from newest to oldest. `newerEntryCount` is the number of
 * entries already read from newer pages. It gives entries without `seqStart`
 * a sequence that is unique for the agent and still orders them by age.
 */
export function promptsFromTimeline(
  agent: { id: string; title?: string | null },
  entries: readonly TimelineEntry[],
  newerEntryCount = 0,
): PromptRecord[] {
  return entries.flatMap((entry, index) => {
    const text = promptText(entry.item);
    if (!text) {
      return [];
    }

    const sequence = entry.seqStart ?? index - entries.length - newerEntryCount;
    const id = entry.seqStart === undefined ? `${agent.id}:page:${sequence}` : `${agent.id}:${sequence}`;
    return [
      {
        id,
        agentId: agent.id,
        agentLabel: agent.title ?? agent.id,
        text,
        sequence,
        createdAt: entry.timestamp,
      },
    ];
  });
}
