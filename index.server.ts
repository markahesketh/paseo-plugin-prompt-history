/// <reference types="node" />
import { randomUUID } from "node:crypto";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { daemonStatus } from "./server/daemon-status";
import { createPromptQueue } from "./server/queue";
import {
  listQueuesRpc,
  removeQueuedPromptRpc,
  resumeQueueRpc,
  sendPromptRpc,
} from "./shared/queue";

const SWEEP_INTERVAL_MS = 5_000;

type PaseoApi = PluginHandlerContext["paseo"];

export default function contribute(server: PluginServerContext) {
  // The server context has no Paseo API of its own. Hooks and RPC handlers
  // each receive the plugin's one connection, so keep the latest one.
  let paseo: PaseoApi | null = null;
  const requirePaseo = () => {
    if (!paseo) {
      throw new Error("Prompt history is not connected to Paseo yet.");
    }
    return paseo;
  };
  const connected =
    <Input, Result>(handler: (input: Input) => Result) =>
    (input: Input, context: PluginHandlerContext): Result => {
      paseo = context.paseo;
      return handler(input);
    };

  const queue = createPromptQueue({
    async send(agentId, text, messageId) {
      await requirePaseo().agents.ref(agentId).send(text, { messageId });
    },
    async status(agentId) {
      return daemonStatus(await requirePaseo().agents.ref(agentId).refresh());
    },
    newId: randomUUID,
    now: Date.now,
  });

  const removeHooks = [
    server.on(
      "agent.turn_started",
      connected((event) => queue.turnStarted(event.agent.id, event.turnId)),
    ),
    server.on(
      "agent.turn_ended",
      connected((event) => queue.turnEnded(event.agent.id, event)),
    ),
    server.on(
      "agent.archived",
      connected((event) => queue.forget(event.agent.id)),
    ),
  ];

  server.handle(
    sendPromptRpc,
    connected(async ({ agentId, text }) => {
      const result = await queue.send(agentId, text);
      return { result, snapshot: queue.snapshot() };
    }),
  );
  server.handle(
    listQueuesRpc,
    connected(() => queue.snapshot()),
  );
  server.handle(
    removeQueuedPromptRpc,
    connected(async ({ agentId, promptId }) => {
      await queue.remove(agentId, promptId);
      return queue.snapshot();
    }),
  );
  server.handle(
    resumeQueueRpc,
    connected(async ({ agentId }) => {
      await queue.resume(agentId);
      return queue.snapshot();
    }),
  );

  // Hook delivery is best effort with no replay, so a missed turn end must
  // not leave prompts waiting forever. Sweeps serialise per agent inside the
  // queue, so one running late cannot double-send.
  const sweepTimer = setInterval(() => void queue.sweep(), SWEEP_INTERVAL_MS);

  return () => {
    clearInterval(sweepTimer);
    for (const remove of removeHooks) {
      remove();
    }
  };
}
