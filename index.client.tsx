import type {
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { historyTitle, pillText } from "./client/labels";
import { createPromptHistory } from "./client/prompt-history";
import { createQueueStore } from "./client/queue";
import { installPromptHistoryHotkey } from "./client/web";
import {
  listQueuesRpc,
  removeQueuedPromptRpc,
  resumeQueueRpc,
  sendPromptRpc,
} from "./shared/queue";

export default function contribute(client: PluginClientContext) {
  const removeHotkey = installPromptHistoryHotkey();
  const queues = createQueueStore({
    list: () => client.rpc(listQueuesRpc, {}),
    send: (input) => client.rpc(sendPromptRpc, input),
    remove: (input) => client.rpc(removeQueuedPromptRpc, input),
    resume: (input) => client.rpc(resumeQueueRpc, input),
  });
  const { PromptHistoryPanel, PromptHistoryPopover } = createPromptHistory(queues);

  const removeWorkspacePanel = client.addWorkspacePanel({
    id: "prompt-history",
    title: "Prompt history",
    icon: "History",
    context: "agent",
    Component: PromptHistoryPanel,
  });

  const removeCommandCenterItem = client.addCommandCenterItem({
    id: "open-prompt-history",
    title: historyTitle,
    icon: "History",
    keywords: ["repeat", "reuse", "previous", "prompts"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel("prompt-history");
    },
  });

  const pills = new Map<
    string,
    { workspaceId: string; registration: PluginButtonRegistration; queuedCount: number }
  >();
  const lifetime = new AbortController();

  const removePill = (agentId: string) => {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  };

  const updateQueuedCount = (agentId: string, queuedCount: number) => {
    const pill = pills.get(agentId);
    if (!pill || pill.queuedCount === queuedCount) {
      return;
    }

    pill.queuedCount = queuedCount;
    pill.registration.update(pillText(queuedCount));
  };

  const registerPill = (agent: {
    id: string;
    workspaceId?: string | null;
    archivedAt?: string | null;
  }) => {
    if (lifetime.signal.aborted || !agent.workspaceId || agent.archivedAt) {
      removePill(agent.id);
      return;
    }

    const queuedCount = queues.get(agent.id)?.prompts.length ?? 0;
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) {
      updateQueuedCount(agent.id, queuedCount);
      return;
    }

    removePill(agent.id);
    const registration = client.addComposerPill({
      id: "prompt-history",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: {
        ...pillText(queuedCount),
        icon: "History",
        behavior: { kind: "popover", Content: PromptHistoryPopover },
      },
    });
    pills.set(agent.id, {
      workspaceId: agent.workspaceId,
      registration,
      queuedCount,
    });
  };

  queues.subscribe(() => {
    for (const agentId of pills.keys()) {
      updateQueuedCount(agentId, queues.get(agentId)?.prompts.length ?? 0);
    }
  });

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) {
        void subscription.release();
        return;
      }

      subscription.subscribe({
        snapshot: ({ entries }) => {
          const snapshotAgentIds = new Set<string>();
          for (const { agent } of entries) {
            snapshotAgentIds.add(agent.id);
            registerPill(agent);
          }
          for (const agentId of pills.keys()) {
            if (!snapshotAgentIds.has(agentId)) {
              removePill(agentId);
            }
          }
        },
        update: (message) => {
          if (message.type !== "agent_update") {
            return;
          }

          if (message.payload.kind === "remove") {
            removePill(message.payload.agentId);
          } else {
            registerPill(message.payload.agent);
          }
          queues.refreshSoon();
        },
      });
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) {
        console.error("Prompt history agent observation failed", error);
      }
    });

  return () => {
    removeHotkey();
    queues.dispose();
    lifetime.abort();
    removeWorkspacePanel();
    removeCommandCenterItem();
    for (const { registration } of pills.values()) {
      registration.remove();
    }
    pills.clear();
  };
}
