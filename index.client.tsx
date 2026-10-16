import type {
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { PromptHistoryPanel, PromptHistoryPopover } from "./client/prompt-history";
import { createQueueStore, installQueueStore } from "./client/queue";
import { installPromptHistoryHotkey } from "./client/web";
import { listQueuesRpc } from "./shared/queue";

// The daemon cannot push queue changes, so the client reads them again after
// agent activity and on this interval.
const QUEUE_POLL_INTERVAL_MS = 10_000;
const QUEUE_REFRESH_DELAY_MS = 300;

export default function contribute(client: PluginClientContext) {
  const removeHotkey = installPromptHistoryHotkey();
  const queues = createQueueStore(() => client.rpc(listQueuesRpc, {}));
  const removeQueueStore = installQueueStore(queues);

  const removeWorkspacePanel = client.addWorkspacePanel({
    id: "prompt-history",
    title: "Prompt history",
    icon: "History",
    context: "agent",
    Component: PromptHistoryPanel,
  });

  const removeCommandCenterItem = client.addCommandCenterItem({
    id: "open-prompt-history",
    title: "Search prompt history",
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
  let stopped = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const refreshQueues = () => {
    void queues.refresh().catch((error: unknown) => {
      if (!stopped) {
        console.warn("Could not read the prompt queue", error);
      }
    });
  };
  const scheduleQueueRefresh = () => {
    if (refreshTimer === null) {
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshQueues();
      }, QUEUE_REFRESH_DELAY_MS);
    }
  };
  const pollTimer = setInterval(refreshQueues, QUEUE_POLL_INTERVAL_MS);

  function queuedLabel(count: number): string {
    return count === 0 ? "History" : `History · ${count} queued`;
  }

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
    pill.registration.update({
      label: queuedLabel(queuedCount),
      title:
        queuedCount === 0
          ? "Search prompt history"
          : `Search prompt history (${queuedCount} queued)`,
    });
  };

  const registerPill = (agent: {
    id: string;
    workspaceId?: string | null;
    archivedAt?: string | null;
  }) => {
    if (stopped || !agent.workspaceId || agent.archivedAt) {
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
        title:
          queuedCount === 0
            ? "Search prompt history"
            : `Search prompt history (${queuedCount} queued)`,
        icon: "History",
        label: queuedLabel(queuedCount),
        behavior: { kind: "popover", Content: PromptHistoryPopover },
      },
    });
    pills.set(agent.id, {
      workspaceId: agent.workspaceId,
      registration,
      queuedCount,
    });
  };

  const removeQueueSubscription = queues.subscribe(() => {
    for (const agentId of pills.keys()) {
      updateQueuedCount(agentId, queues.get(agentId)?.prompts.length ?? 0);
    }
  });
  refreshQueues();

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (stopped) {
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
          scheduleQueueRefresh();
        },
      });
    })
    .catch((error) => {
      if (!stopped) {
        console.error("Prompt history agent observation failed", error);
      }
    });

  return () => {
    stopped = true;
    removeHotkey();
    clearInterval(pollTimer);
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
    }
    removeQueueSubscription();
    removeQueueStore();
    lifetime.abort();
    removeWorkspacePanel();
    removeCommandCenterItem();
    for (const { registration } of pills.values()) {
      registration.remove();
    }
    pills.clear();
  };
}
