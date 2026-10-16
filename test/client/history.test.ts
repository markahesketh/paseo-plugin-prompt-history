import { test } from "node:test";
import assert from "node:assert/strict";
import { promptsFromTimeline } from "../../client/history.ts";

const agent = { id: "agent-1", title: "Review agent" };

function userMessage(text: string, seqStart?: number) {
  return {
    item: { type: "user_message", text },
    timestamp: "2026-09-29T10:01:00.000Z",
    ...(seqStart === undefined ? {} : { seqStart }),
  };
}

test("only user messages become prompts", () => {
  const prompts = promptsFromTimeline(agent, [
    {
      item: { type: "assistant_message", text: "skip me" },
      timestamp: "2026-09-29T10:00:00.000Z",
      seqStart: 1,
    },
    userMessage("Review the prompt history", 2),
  ]);

  assert.deepEqual(
    prompts.map(({ id, text }) => ({ id, text })),
    [{ id: "agent-1:2", text: "Review the prompt history" }],
  );
});

test("entries without seqStart keep unique, age-ordered IDs across pages", () => {
  const newerPage = promptsFromTimeline(agent, [userMessage("newer a"), userMessage("newer b")]);
  const olderPage = promptsFromTimeline(agent, [userMessage("older a"), userMessage("older b")], 2);
  const prompts = [...olderPage, ...newerPage];

  assert.equal(new Set(prompts.map(({ id }) => id)).size, 4);
  assert.deepEqual(
    [...prompts].sort((left, right) => left.sequence - right.sequence).map(({ text }) => text),
    ["older a", "older b", "newer a", "newer b"],
  );
});
