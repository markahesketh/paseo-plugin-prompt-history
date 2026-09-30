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

export function promptsFromTimeline(
  agent: { id: string; title?: string | null },
  entries: readonly TimelineEntry[],
): PromptRecord[] {
  return entries.flatMap((entry, index) => {
    const text = promptText(entry.item);
    if (!text) {
      return [];
    }

    return [
      {
        id: `${agent.id}:${entry.seqStart ?? index}`,
        agentId: agent.id,
        agentLabel: agent.title ?? agent.id,
        text,
        sequence: entry.seqStart ?? index,
        createdAt: entry.timestamp,
      },
    ];
  });
}
