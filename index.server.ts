import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import { daemonStatus } from "./server/daemon-status";
import { createPromptQueue } from "./server/queue";
import {
  listQueuesRpc,
  removeQueuedPromptRpc,
  resumeQueueRpc,
  sendPromptRpc,
} from "./shared/queue";

const SWEEP_INTERVAL_MS = 5_000;

type PaseoApi = PluginHookContext["paseo"];

let nextId = 0;
function newId(): string {
  nextId += 1;
  return `${Date.now().toString(36)}-${nextId.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function contribute(server: PluginServerContext) {
  // The server context has no Paseo API of its own. Hooks and RPC handlers
  // each receive the plugin's one connection, so keep the latest one.
  let paseo: PaseoApi | null = null;
  const remember = (api: PaseoApi) => {
    paseo = api;
  };
  const requirePaseo = () => {
    if (!paseo) {
      throw new Error("Prompt history is not connected to Paseo yet.");
    }
    return paseo;
  };

  const queue = createPromptQueue({
    async send(agentId, text, messageId) {
      await requirePaseo().agents.ref(agentId).send(text, { messageId });
    },
    async status(agentId) {
      return daemonStatus(await requirePaseo().agents.ref(agentId).refresh());
    },
    newId,
    now: Date.now,
  });

  const removeTurnStarted = server.on("agent.turn_started", async (event, context) => {
    remember(context.paseo);
    await queue.turnStarted(event.agent.id, event.turnId);
  });
  const removeTurnEnded = server.on("agent.turn_ended", async (event, context) => {
    remember(context.paseo);
    await queue.turnEnded(event.agent.id, event);
  });
  const removeArchived = server.on("agent.archived", async (event, context) => {
    remember(context.paseo);
    await queue.forget(event.agent.id);
  });

  server.handle(sendPromptRpc, async ({ agentId, text }, context) => {
    remember(context.paseo);
    const result = await queue.send(agentId, text);
    return { result, snapshot: queue.snapshot() };
  });
  server.handle(listQueuesRpc, (_input, context) => {
    remember(context.paseo);
    return queue.snapshot();
  });
  server.handle(removeQueuedPromptRpc, async ({ agentId, promptId }, context) => {
    remember(context.paseo);
    await queue.remove(agentId, promptId);
    return queue.snapshot();
  });
  server.handle(resumeQueueRpc, async ({ agentId }, context) => {
    remember(context.paseo);
    await queue.resume(agentId);
    return queue.snapshot();
  });

  // Hook delivery is best effort with no replay, so a missed turn end must
  // not leave prompts waiting forever.
  let sweeping = false;
  const sweepTimer = setInterval(() => {
    if (sweeping || !paseo || !queue.hasQueuedPrompts()) {
      return;
    }
    sweeping = true;
    void queue.sweep().finally(() => {
      sweeping = false;
    });
  }, SWEEP_INTERVAL_MS);

  return () => {
    clearInterval(sweepTimer);
    removeTurnStarted();
    removeTurnEnded();
    removeArchived();
  };
}
