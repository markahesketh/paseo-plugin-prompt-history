import { test } from "node:test";
import assert from "node:assert/strict";
import { createPromptQueue, TURN_START_GRACE_MS } from "../../server/queue.ts";

function fakeDaemon() {
  const daemon = {
    busy: false,
    failNextSend: false,
    time: 0,
    ids: 0,
    sent: [] as { agentId: string; text: string; messageId: string }[],
  };
  const queue = createPromptQueue({
    async send(agentId, text, messageId) {
      if (daemon.failNextSend) {
        daemon.failNextSend = false;
        throw new Error("daemon unavailable");
      }
      daemon.sent.push({ agentId, text, messageId });
    },
    async isBusy() {
      return daemon.busy;
    },
    newId: () => `id-${(daemon.ids += 1)}`,
    now: () => daemon.time,
  });
  return { daemon, queue, sentTexts: () => daemon.sent.map(({ text }) => text) };
}

function queuedTexts(queue: ReturnType<typeof fakeDaemon>["queue"], agentId: string) {
  return (
    queue
      .snapshot()
      .queues.find((entry) => entry.agentId === agentId)
      ?.prompts.map(({ text }) => text) ?? []
  );
}

test("sends at once when the agent is idle", async () => {
  const { queue, sentTexts } = fakeDaemon();

  assert.equal(await queue.send("agent", "first"), "sent");
  assert.deepEqual(sentTexts(), ["first"]);
});

test("queues a prompt sent while the daemon reports a running turn", async () => {
  const { daemon, queue, sentTexts } = fakeDaemon();
  daemon.busy = true;

  assert.equal(await queue.send("agent", "later"), "queued");
  assert.deepEqual(sentTexts(), []);
});

test("queues a second prompt before the daemon reports the first turn", async () => {
  const { queue, sentTexts } = fakeDaemon();

  await queue.send("agent", "first");
  assert.equal(await queue.send("agent", "second"), "queued");
  assert.deepEqual(sentTexts(), ["first"]);
});

test("sends one queued prompt for each completed turn, in order", async () => {
  const { queue, sentTexts } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await queue.send("agent", "third");

  await queue.turnEnded("agent", { kind: "completed" });
  assert.deepEqual(sentTexts(), ["first", "second"]);

  await queue.turnEnded("agent", { kind: "completed" });
  assert.deepEqual(sentTexts(), ["first", "second", "third"]);
  assert.deepEqual(queue.snapshot().queues, []);
});

test("does not lose a turn end that arrives while a queued send is pending", async () => {
  const { queue, sentTexts } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await queue.send("agent", "third");

  // The second prompt's turn ends before the first turn-end handler finishes.
  const firstEnd = queue.turnEnded("agent", { kind: "completed" });
  const secondEnd = queue.turnEnded("agent", { kind: "completed" });
  await Promise.all([firstEnd, secondEnd]);

  assert.deepEqual(sentTexts(), ["first", "second", "third"]);
});

test("uses the queued prompt ID as the message ID", async () => {
  const { daemon, queue } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  const [queued] = queue.snapshot().queues[0]!.prompts;

  await queue.turnEnded("agent", { kind: "completed" });

  assert.equal(daemon.sent[1]!.messageId, queued!.id);
});

test("pauses instead of sending when a turn is stopped or fails", async () => {
  for (const kind of ["canceled", "failed"] as const) {
    const { queue, sentTexts } = fakeDaemon();
    await queue.send("agent", "first");
    await queue.send("agent", "second");

    await queue.turnEnded("agent", { kind });

    assert.deepEqual(sentTexts(), ["first"]);
    assert.notEqual(queue.snapshot().queues[0]!.paused, null);
  }
});

test("keeps a prompt that fails to send, pauses, and sends it on resume", async () => {
  const { daemon, queue, sentTexts } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  daemon.failNextSend = true;

  await queue.turnEnded("agent", { kind: "completed" });
  assert.deepEqual(queuedTexts(queue, "agent"), ["second"]);
  assert.match(queue.snapshot().queues[0]!.paused ?? "", /daemon unavailable/);

  await queue.resume("agent");
  assert.deepEqual(sentTexts(), ["first", "second"]);
  assert.deepEqual(queue.snapshot().queues, []);
});

test("a paused queue holds new prompts until it is resumed", async () => {
  const { queue, sentTexts } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await queue.turnEnded("agent", { kind: "canceled" });

  assert.equal(await queue.send("agent", "third"), "queued");
  assert.deepEqual(sentTexts(), ["first"]);
});

test("removing the last queued prompt clears the pause", async () => {
  const { queue, sentTexts } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await queue.turnEnded("agent", { kind: "canceled" });
  const [queued] = queue.snapshot().queues[0]!.prompts;

  await queue.remove("agent", queued!.id);
  await queue.turnEnded("agent", { kind: "completed" });

  assert.deepEqual(queue.snapshot().queues, []);
  assert.equal(await queue.send("agent", "third"), "sent");
  assert.deepEqual(sentTexts(), ["first", "third"]);
});

test("a turn started elsewhere makes new prompts wait", async () => {
  const { queue, sentTexts } = fakeDaemon();

  await queue.turnStarted("agent");

  assert.equal(await queue.send("agent", "later"), "queued");
  assert.deepEqual(sentTexts(), []);
});

test("the sweep sends a prompt after a missed turn end, but not too early", async () => {
  const { daemon, queue, sentTexts } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");

  daemon.time = TURN_START_GRACE_MS - 1;
  await queue.sweep();
  assert.deepEqual(sentTexts(), ["first"]);

  daemon.time = TURN_START_GRACE_MS;
  daemon.busy = true;
  await queue.sweep();
  assert.deepEqual(sentTexts(), ["first"]);

  daemon.busy = false;
  await queue.sweep();
  assert.deepEqual(sentTexts(), ["first", "second"]);
});

test("forgetting an archived agent drops its queue", async () => {
  const { queue } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");

  await queue.forget("agent");

  assert.deepEqual(queue.snapshot().queues, []);
  assert.equal(queue.hasQueuedPrompts(), false);
});
