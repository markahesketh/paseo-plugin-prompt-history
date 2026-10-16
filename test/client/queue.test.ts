import { test } from "node:test";
import assert from "node:assert/strict";
import type { QueueSnapshot } from "../../shared/queue.ts";
import { createQueueStore } from "../../client/queue.ts";

function snapshotWith(count: number): QueueSnapshot {
  return {
    queues: [
      {
        agentId: "agent",
        paused: null,
        prompts: Array.from({ length: count }, (_, index) => ({
          id: `prompt-${index}`,
          text: `prompt ${index}`,
          queuedAt: "2026-10-02T10:00:00.000Z",
        })),
      },
    ],
  };
}

test("a slow, older refresh does not replace a newer snapshot", async () => {
  const responses: ((snapshot: QueueSnapshot) => void)[] = [];
  const store = createQueueStore(
    () => new Promise<QueueSnapshot>((resolve) => responses.push(resolve)),
  );

  const older = store.refresh();
  store.apply(snapshotWith(2));
  responses[0]!(snapshotWith(5));
  await older;

  assert.equal(store.get("agent")?.prompts.length, 2);
});
