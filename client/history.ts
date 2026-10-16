import type { usePaseo } from "@getpaseo/plugin/client";

export type PromptRecord = {
  id: string;
  agentId: string;
  agentLabel: string;
  text: string;
  sequence: number;
  createdAt: string | null;
};

type Paseo = ReturnType<typeof usePaseo>;
type TimelineEntry = Awaited<
  ReturnType<ReturnType<Paseo["agents"]["ref"]>["timeline"]["refetch"]>
>["entries"][number];

export type PromptEntry = Pick<TimelineEntry, "item" | "timestamp" | "seqStart">;

export function promptsFromTimeline(
  agent: { id: string; title?: string | null },
  entries: readonly PromptEntry[],
): PromptRecord[] {
  return entries.flatMap(({ item, timestamp, seqStart }) =>
    item.type === "user_message" && item.text.trim()
      ? [
          {
            id: `${agent.id}:${seqStart}`,
            agentId: agent.id,
            agentLabel: agent.title ?? agent.id,
            text: item.text,
            sequence: seqStart,
            createdAt: timestamp,
          },
        ]
      : [],
  );
}
