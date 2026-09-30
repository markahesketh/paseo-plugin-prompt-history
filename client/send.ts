import type { PluginClientContext } from "@getpaseo/plugin/client";

type Paseo = PluginClientContext["paseo"];

export type PromptAgentActivity = {
  id: string;
  status?: string | null;
  activeTurn?: unknown | null;
};

export type PromptSendResult = "sent" | "queued";
export type PromptQueueListener = (
  agentId: string,
  messages: readonly string[],
) => void;

type PromptAgentHandle = ReturnType<Paseo["agents"]["ref"]>;

type PromptSendQueue = {
  send(agentId: string, text: string): Promise<PromptSendResult>;
  observe(activity: PromptAgentActivity): void;
  subscribe(listener: PromptQueueListener): () => void;
  get(agentId: string): readonly string[];
  dispose(): void;
};

function agentIsBusy(activity: PromptAgentActivity): boolean {
  return activity.status === "running" || activity.activeTurn != null;
}

function handleIsBusy(agent: PromptAgentHandle): boolean {
  return agent.status === "running" || agent.activeTurn != null;
}

export function createPromptSendQueue(paseo: Paseo): PromptSendQueue {
  const queued = new Map<string, string[]>();
  const activity = new Map<string, PromptAgentActivity>();
  const draining = new Set<string>();
  const listeners = new Set<PromptQueueListener>();
  let disposed = false;

  function notify(agentId: string): void {
    const messages = [...(queued.get(agentId) ?? [])];
    for (const listener of listeners) {
      listener(agentId, messages);
    }
  }

  function isBusy(agentId: string): boolean {
    const observed = activity.get(agentId);
    if (observed) {
      return agentIsBusy(observed);
    }

    return handleIsBusy(paseo.agents.ref(agentId));
  }

  async function drain(agentId: string): Promise<void> {
    if (disposed || draining.has(agentId) || isBusy(agentId)) {
      return;
    }

    const messages = queued.get(agentId);
    const text = messages?.[0];
    if (!text) {
      return;
    }

    draining.add(agentId);
    try {
      await paseo.agents.ref(agentId).send(text);
      messages.shift();
      if (messages.length === 0) {
        queued.delete(agentId);
      }
      notify(agentId);
    } catch (error) {
      console.warn(`Could not send queued prompt for ${agentId}`, error);
    } finally {
      draining.delete(agentId);
    }
  }

  return {
    async send(agentId, text) {
      if (disposed) {
        throw new Error("Prompt history is no longer available.");
      }

      if (isBusy(agentId) || queued.has(agentId)) {
        const messages = queued.get(agentId) ?? [];
        messages.push(text);
        queued.set(agentId, messages);
        notify(agentId);
        return "queued";
      }

      await paseo.agents.ref(agentId).send(text);
      return "sent";
    },

    observe(nextActivity) {
      if (disposed) {
        return;
      }

      activity.set(nextActivity.id, nextActivity);
      if (!agentIsBusy(nextActivity)) {
        void drain(nextActivity.id);
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    get(agentId) {
      return [...(queued.get(agentId) ?? [])];
    },

    dispose() {
      disposed = true;
      for (const agentId of queued.keys()) {
        notify(agentId);
      }
      queued.clear();
      activity.clear();
      draining.clear();
      listeners.clear();
    },
  };
}

let installedQueue: PromptSendQueue | null = null;

export function installPromptSendQueue(paseo: Paseo): () => void {
  installedQueue?.dispose();
  const queue = createPromptSendQueue(paseo);
  installedQueue = queue;

  return () => {
    if (installedQueue === queue) {
      installedQueue = null;
    }
    queue.dispose();
  };
}

export function observePromptAgent(activity: PromptAgentActivity): void {
  installedQueue?.observe(activity);
}

export function getQueuedPrompts(agentId: string): readonly string[] {
  return installedQueue?.get(agentId) ?? [];
}

export function subscribePromptQueue(listener: PromptQueueListener): () => void {
  return installedQueue?.subscribe(listener) ?? (() => undefined);
}

export async function sendPrompt(
  paseo: Paseo,
  agentId: string,
  text: string,
): Promise<PromptSendResult> {
  if (installedQueue) {
    return installedQueue.send(agentId, text);
  }

  await paseo.agents.ref(agentId).send(text);
  return "sent";
}
