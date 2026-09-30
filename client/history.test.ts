import { promptsFromTimeline } from "./history.ts";

function assertEqual<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const prompts = promptsFromTimeline(
  { id: "agent-1", title: "Review agent" },
  [
    {
      item: { type: "assistant_message", text: "skip me" },
      timestamp: "2026-09-29T10:00:00.000Z",
      seqStart: 1,
    },
    {
      item: { type: "user_message", text: "Review the prompt history" },
      timestamp: "2026-09-29T10:01:00.000Z",
      seqStart: 2,
    },
  ],
);

assertEqual(prompts.length, 1);
assertEqual(prompts[0]?.createdAt, "2026-09-29T10:01:00.000Z");
assertEqual(prompts[0]?.id, "agent-1:2");

console.log("history tests passed");
