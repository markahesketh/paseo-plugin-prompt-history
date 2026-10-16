import { test } from "node:test";
import assert from "node:assert/strict";
import type { PluginTurnOutcome } from "@getpaseo/plugin/server";
import {
  createPromptQueue,
  TURN_START_GRACE_MS,
  type DaemonStatus,
} from "../../server/queue.ts";

type Sent = { agentId: string; text: string; messageId: string; turnId: string };

const completed: PluginTurnOutcome = { kind: "completed" };
const canceled: PluginTurnOutcome = { kind: "canceled", reason: "user stopped it" };
const failed: PluginTurnOutcome = { kind: "failed", error: { message: "provider crashed" } };

function fakeDaemon() {
  const daemon = {
    status: "idle" as DaemonStatus,
    failNextSend: false,
    time: 0,
    ids: 0,
    sent: [] as Sent[],
  };
  const queue = createPromptQueue({
    async send(agentId, text, messageId) {
      if (daemon.failNextSend) {
        daemon.failNextSend = false;
        throw new Error("daemon unavailable");
      }
      daemon.sent.push({ agentId, text, messageId, turnId: `turn-${daemon.sent.length + 1}` });
    },
    async status() {
      return daemon.status;
    },
    newId: () => `id-${(daemon.ids += 1)}`,
    now: () => daemon.time,
  });
  return {
    daemon,
    queue,
    sentTexts: () => daemon.sent.map(({ text }) => text),
    // The hooks the daemon fires for a prompt it accepted.
    startTurn: (sent: Sent) => queue.turnStarted(sent.agentId, sent.turnId),
    endTurn: (sent: Sent, outcome = completed) =>
      queue.turnEnded(sent.agentId, {
        turnId: sent.turnId,
        outcome,
        timeline: [{ type: "user_message", text: sent.text, clientMessageId: sent.messageId }],
      }),
  };
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
  daemon.status = "busy";

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
  const { daemon, queue, sentTexts, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await queue.send("agent", "third");

  await endTurn(daemon.sent[0]!);
  assert.deepEqual(sentTexts(), ["first", "second"]);

  await endTurn(daemon.sent[1]!);
  assert.deepEqual(sentTexts(), ["first", "second", "third"]);
  assert.deepEqual(queue.snapshot().queues, []);
});

test("uses the queued prompt ID as the message ID", async () => {
  const { daemon, queue, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  const [queued] = queue.snapshot().queues[0]!.prompts;

  await endTurn(daemon.sent[0]!);

  assert.equal(daemon.sent[1]!.messageId, queued!.id);
});

test("pauses instead of sending when a turn is stopped or fails", async () => {
  for (const outcome of [canceled, failed]) {
    const { daemon, queue, sentTexts, endTurn } = fakeDaemon();
    await queue.send("agent", "first");
    await queue.send("agent", "second");

    await endTurn(daemon.sent[0]!, outcome);

    assert.deepEqual(sentTexts(), ["first"]);
    const reason = outcome.kind === "canceled" ? /user stopped it/ : /provider crashed/;
    assert.match(queue.snapshot().queues[0]!.paused ?? "", reason);
  }
});

test("drops a prompt the daemon ran despite a failed send, then continues", async () => {
  const { daemon, queue, sentTexts, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await queue.send("agent", "third");
  daemon.failNextSend = true;
  await endTurn(daemon.sent[0]!);
  const [second] = queue.snapshot().queues[0]!.prompts;

  // The send timed out on our side, but the daemon ran "second" and reports its turn.
  await queue.turnEnded("agent", {
    turnId: "turn-x",
    outcome: completed,
    timeline: [{ type: "user_message", text: "second", clientMessageId: second!.id }],
  });

  assert.deepEqual(sentTexts(), ["first", "third"]);
  assert.deepEqual(queue.snapshot().queues, []);
});

test("keeps a prompt that fails to send, pauses, and sends it on resume", async () => {
  const { daemon, queue, sentTexts, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  daemon.failNextSend = true;

  await endTurn(daemon.sent[0]!);
  assert.deepEqual(queuedTexts(queue, "agent"), ["second"]);
  assert.match(queue.snapshot().queues[0]!.paused ?? "", /daemon unavailable/);

  await queue.resume("agent");
  assert.deepEqual(sentTexts(), ["first", "second"]);
  assert.deepEqual(queue.snapshot().queues, []);
});

test("a paused queue holds new prompts until it is resumed", async () => {
  const { daemon, queue, sentTexts, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await endTurn(daemon.sent[0]!, canceled);

  assert.equal(await queue.send("agent", "third"), "queued");
  assert.deepEqual(sentTexts(), ["first"]);
});

test("removing the last queued prompt clears the pause", async () => {
  const { daemon, queue, sentTexts, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await endTurn(daemon.sent[0]!, canceled);
  const [queued] = queue.snapshot().queues[0]!.prompts;

  await queue.remove("agent", queued!.id);
  await endTurn(daemon.sent[0]!);

  assert.deepEqual(queue.snapshot().queues, []);
  assert.equal(await queue.send("agent", "third"), "sent");
  assert.deepEqual(sentTexts(), ["first", "third"]);
});

test("a turn started with nothing queued does not block a later send", async () => {
  const { queue, sentTexts } = fakeDaemon();

  // The daemon's turn_ended hook for this turn never arrives.
  await queue.turnStarted("agent", "turn-x");

  assert.equal(await queue.send("agent", "later"), "sent");
  assert.deepEqual(sentTexts(), ["later"]);
});

test("a send past the grace window asks the daemon instead of trusting a stale turn", async () => {
  const { daemon, queue, sentTexts } = fakeDaemon();
  await queue.send("agent", "first");

  daemon.time = TURN_START_GRACE_MS;
  assert.equal(await queue.send("agent", "second"), "sent");
  assert.deepEqual(sentTexts(), ["first", "second"]);
});

test("the sweep sends a prompt after a missed turn end, but not too early", async () => {
  const { daemon, queue, sentTexts } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");

  daemon.time = TURN_START_GRACE_MS - 1;
  await queue.sweep();
  assert.deepEqual(sentTexts(), ["first"]);

  daemon.time = TURN_START_GRACE_MS;
  daemon.status = "busy";
  await queue.sweep();
  assert.deepEqual(sentTexts(), ["first"]);

  daemon.status = "idle";
  await queue.sweep();
  assert.deepEqual(sentTexts(), ["first", "second"]);
});

test("ignores the late end of a turn the sweep already replaced", async () => {
  const { daemon, queue, sentTexts, startTurn, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await queue.send("agent", "third");
  await startTurn(daemon.sent[0]!);

  // The first turn outlives the grace window and its end hook is slow, so the
  // sweep sees an idle daemon and sends the second prompt first.
  daemon.time = TURN_START_GRACE_MS;
  await queue.sweep();
  assert.deepEqual(sentTexts(), ["first", "second"]);

  await endTurn(daemon.sent[0]!);
  assert.deepEqual(sentTexts(), ["first", "second"]);

  await endTurn(daemon.sent[1]!);
  assert.deepEqual(sentTexts(), ["first", "second", "third"]);
});

test("ignores the late end of an earlier turn once the next turn has started", async () => {
  const { daemon, queue, sentTexts, startTurn, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await queue.send("agent", "third");
  await startTurn(daemon.sent[0]!);
  daemon.time = TURN_START_GRACE_MS;
  await queue.sweep();
  await startTurn(daemon.sent[1]!);

  await endTurn(daemon.sent[0]!);
  assert.deepEqual(sentTexts(), ["first", "second"]);

  await endTurn(daemon.sent[1]!);
  assert.deepEqual(sentTexts(), ["first", "second", "third"]);
});

test("the sweep forgets the queue of an agent the daemon no longer has", async () => {
  const { daemon, queue, sentTexts } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  daemon.status = "gone";

  daemon.time = TURN_START_GRACE_MS;
  await queue.sweep();

  assert.deepEqual(sentTexts(), ["first"]);
  assert.deepEqual(queue.snapshot().queues, []);
});

test("refuses to send to an agent the daemon no longer has", async () => {
  const { daemon, queue, sentTexts } = fakeDaemon();
  daemon.status = "gone";

  await assert.rejects(queue.send("agent", "first"));
  assert.deepEqual(sentTexts(), []);
});

test("forgetting an archived agent drops its queue", async () => {
  const { queue } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");

  await queue.forget("agent");

  assert.deepEqual(queue.snapshot().queues, []);
});

test("removing a prompt behind the head keeps the rest in order", async () => {
  const { daemon, queue, sentTexts, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await queue.send("agent", "third");
  const third = queue.snapshot().queues[0]!.prompts[1]!;

  await queue.remove("agent", third.id);
  assert.deepEqual(queuedTexts(queue, "agent"), ["second"]);

  await endTurn(daemon.sent[0]!);
  assert.deepEqual(sentTexts(), ["first", "second"]);
  assert.deepEqual(queue.snapshot().queues, []);
});

test("resuming while the daemon is busy clears the pause but sends nothing", async () => {
  const { daemon, queue, sentTexts, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await endTurn(daemon.sent[0]!, canceled);
  daemon.status = "busy";

  await queue.resume("agent");
  assert.deepEqual(sentTexts(), ["first"]);
  assert.equal(queue.snapshot().queues[0]!.paused, null);

  daemon.status = "idle";
  await queue.sweep();
  assert.deepEqual(sentTexts(), ["first", "second"]);
});

test("the sweep leaves a paused queue alone", async () => {
  const { daemon, queue, sentTexts, endTurn } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  await endTurn(daemon.sent[0]!, canceled);
  daemon.time = TURN_START_GRACE_MS;

  await queue.sweep();

  assert.deepEqual(sentTexts(), ["first"]);
});

test("a direct send the daemon rejects propagates and leaves nothing behind", async () => {
  const { daemon, queue, sentTexts } = fakeDaemon();
  daemon.failNextSend = true;

  await assert.rejects(queue.send("agent", "first"), /daemon unavailable/);

  assert.deepEqual(queue.snapshot().queues, []);
  assert.equal(await queue.send("agent", "second"), "sent");
  assert.deepEqual(sentTexts(), ["second"]);
});

test("overlapping sweeps send one prompt", async () => {
  const { daemon, queue, sentTexts } = fakeDaemon();
  await queue.send("agent", "first");
  await queue.send("agent", "second");
  daemon.time = TURN_START_GRACE_MS;

  await Promise.all([queue.sweep(), queue.sweep()]);

  assert.deepEqual(sentTexts(), ["first", "second"]);
});
