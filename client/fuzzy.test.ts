import { rankPrompts, type PromptRecord } from "./fuzzy.ts";

function assertEqual(actual: readonly string[], expected: readonly string[]): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const prompts: PromptRecord[] = [
  {
    id: "one",
    agentId: "agent",
    agentLabel: "Agent",
    text: "Review the warehouse dashboard",
    sequence: 1,
    createdAt: null,
  },
  {
    id: "two",
    agentId: "agent",
    agentLabel: "Agent",
    text: "Run the dashboard checks",
    sequence: 2,
    createdAt: null,
  },
];

assertEqual(
  rankPrompts(prompts, "warehouse dash").map(({ id }) => id),
  ["one"],
);
assertEqual(
  rankPrompts(prompts, "").map(({ id }) => id),
  ["two", "one"],
);

assertEqual(
  rankPrompts(prompts, "rwd").map(({ id }) => id),
  ["one"],
);

const repeated: PromptRecord[] = [
  {
    ...prompts[0],
    id: "old",
    sequence: 100,
    createdAt: "2026-09-29T09:00:00.000Z",
  },
  {
    ...prompts[0],
    id: "new",
    sequence: 1,
    createdAt: "2026-09-29T10:00:00.000Z",
  },
];
assertEqual(rankPrompts(repeated, "").map(({ id }) => id), ["new"]);
