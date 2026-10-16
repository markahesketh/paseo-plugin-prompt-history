import { test } from "node:test";
import assert from "node:assert/strict";
import { promptsFromTimeline, type PromptEntry } from "../../client/history.ts";

const agent = { id: "agent-1", title: "Review agent" };

function userMessage(text: string, seqStart: number): PromptEntry {
  return {
    item: { type: "user_message", text },
    timestamp: "2026-09-29T10:01:00.000Z",
    seqStart,
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

test("blank user messages are skipped", () => {
  assert.deepEqual(promptsFromTimeline(agent, [userMessage("  \n ", 1)]), []);
});

test("a prompt is labelled with the agent title and falls back to its id", () => {
  const [titled] = promptsFromTimeline(agent, [userMessage("hello", 1)]);
  const [untitled] = promptsFromTimeline({ id: "agent-2" }, [userMessage("hello", 1)]);

  assert.equal(titled?.agentLabel, "Review agent");
  assert.equal(untitled?.agentLabel, "agent-2");
});
