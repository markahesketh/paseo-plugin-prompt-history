import { test } from "node:test";
import assert from "node:assert/strict";
import { deduplicatePrompts, rankPrompts, type PromptRecord } from "../../client/fuzzy.ts";

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

const ids = (ranked: readonly { id: string }[]) => ranked.map(({ id }) => id);

test("a substring query matches only prompts that contain it", () => {
  assert.deepEqual(ids(rankPrompts(prompts, "warehouse dash")), ["one"]);
});

test("an empty query lists the newest prompts first", () => {
  assert.deepEqual(ids(rankPrompts(prompts, "")), ["two", "one"]);
});

test("a query matches word starts in order", () => {
  assert.deepEqual(ids(rankPrompts(prompts, "rwd")), ["one"]);
});

test("deduplication keeps the newest copy of a prompt", () => {
  const repeated: PromptRecord[] = [
    { ...prompts[0]!, id: "old", sequence: 100, createdAt: "2026-09-29T09:00:00.000Z" },
    { ...prompts[0]!, id: "new", sequence: 1, createdAt: "2026-09-29T10:00:00.000Z" },
  ];

  assert.deepEqual(ids(deduplicatePrompts(repeated)), ["new"]);
});
