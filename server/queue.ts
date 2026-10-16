import type { PluginTurnOutcome } from "@getpaseo/plugin/server";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { AgentQueue, QueuedPrompt, QueueSnapshot } from "../shared/queue";

/** "gone" is an agent the daemon has archived or no longer has. */
export type DaemonStatus = "busy" | "idle" | "gone";

export type TurnEnd = {
  turnId: string | null;
  outcome: PluginTurnOutcome;
  timeline: readonly AgentTimelineItem[];
};

export type PromptQueueDeps = {
  /** Resolves when the daemon accepts the prompt. */
  send(agentId: string, text: string, messageId: string): Promise<void>;
  /** Reads the daemon's current view of the agent. */
  status(agentId: string): Promise<DaemonStatus>;
  newId(): string;
  now(): number;
};

export type PromptQueue = {
  send(agentId: string, text: string): Promise<"sent" | "queued">;
  turnStarted(agentId: string, turnId: string | null): Promise<void>;
  turnEnded(agentId: string, end: TurnEnd): Promise<void>;
  /** Fallback for missed turn events: drains queues whose agent is idle. */
  sweep(): Promise<void>;
  remove(agentId: string, promptId: string): Promise<void>;
  resume(agentId: string): Promise<void>;
  forget(agentId: string): Promise<void>;
  hasQueuedPrompts(): boolean;
  snapshot(): QueueSnapshot;
};

/** The turn this queue believes is running, from its own send or a turn event. */
type Turn =
  | { phase: "sent"; messageId: string; since: number }
  | { phase: "running"; turnId: string | null; since: number };

type AgentState = {
  prompts: QueuedPrompt[];
  paused: string | null;
  turn: Turn | null;
};

// A sent prompt can take a moment to show as running. Until this time passes,
// the sweep trusts our own record of the turn over the daemon's status.
export const TURN_START_GRACE_MS = 60_000;

function deliveredIds(timeline: readonly AgentTimelineItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of timeline) {
    if (item.type === "user_message" && item.clientMessageId) {
      ids.add(item.clientMessageId);
    }
  }
  return ids;
}

// Hooks arrive late and out of order, so an end event may belong to a turn
// this queue has already moved past.
function endsTrackedTurn(turn: Turn | null, end: TurnEnd, delivered: Set<string>): boolean {
  if (turn === null) {
    return true;
  }
  if (turn.phase === "sent") {
    return delivered.has(turn.messageId);
  }
  return turn.turnId === null || end.turnId === null || turn.turnId === end.turnId;
}

export function createPromptQueue(deps: PromptQueueDeps): PromptQueue {
  const agents = new Map<string, AgentState>();
  const locks = new Map<string, Promise<void>>();

  function state(agentId: string): AgentState {
    let current = agents.get(agentId);
    if (!current) {
      current = { prompts: [], paused: null, turn: null };
      agents.set(agentId, current);
    }
    return current;
  }

  function prune(agentId: string): void {
    const current = agents.get(agentId);
    if (current && current.prompts.length === 0 && current.turn === null) {
      agents.delete(agentId);
    }
  }

  // Runs one operation at a time for each agent, so a send and a drain cannot
  // both decide that the agent is idle.
  function exclusive<T>(agentId: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(agentId) ?? Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    locks.set(agentId, settled);
    void settled.then(() => {
      if (locks.get(agentId) === settled) {
        locks.delete(agentId);
      }
    });
    return result;
  }

  // Our own turn record is trusted for the grace window; after that the daemon
  // decides, so a missed turn end cannot hold an agent busy forever.
  async function availability(agentId: string, current: AgentState): Promise<DaemonStatus> {
    if (current.turn !== null && deps.now() - current.turn.since < TURN_START_GRACE_MS) {
      return "busy";
    }
    const status = await deps.status(agentId);
    if (status === "idle") {
      current.turn = null;
    }
    return status;
  }

  async function sendNext(agentId: string, current: AgentState): Promise<void> {
    const next = current.prompts[0];
    if (!next || current.paused !== null) {
      return;
    }

    try {
      await deps.send(agentId, next.text, next.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      current.paused = `Could not send the next prompt: ${message}`;
      return;
    }

    current.prompts.shift();
    current.turn = { phase: "sent", messageId: next.id, since: deps.now() };
    if (current.prompts.length === 0) {
      current.paused = null;
    }
  }

  return {
    send(agentId, text) {
      return exclusive(agentId, async () => {
        const current = state(agentId);
        try {
          if (
            current.prompts.length > 0 ||
            (await availability(agentId, current)) === "busy"
          ) {
            current.prompts.push({
              id: deps.newId(),
              text,
              queuedAt: new Date(deps.now()).toISOString(),
            });
            return "queued";
          }

          const messageId = deps.newId();
          await deps.send(agentId, text, messageId);
          current.turn = { phase: "sent", messageId, since: deps.now() };
          return "sent";
        } finally {
          prune(agentId);
        }
      });
    },

    turnStarted(agentId, turnId) {
      return exclusive(agentId, async () => {
        const current = agents.get(agentId);
        if (current) {
          current.turn = { phase: "running", turnId, since: deps.now() };
        }
      });
    },

    turnEnded(agentId, end) {
      return exclusive(agentId, async () => {
        const current = agents.get(agentId);
        if (!current) {
          return;
        }

        if (!endsTrackedTurn(current.turn, end, deliveredIds(end.timeline))) {
          return;
        }

        current.turn = null;
        if (current.prompts.length > 0 && current.paused === null) {
          if (end.outcome.kind === "canceled") {
            current.paused = "Paused because the turn was stopped.";
          } else if (end.outcome.kind === "failed") {
            current.paused = "Paused because the turn failed.";
          } else {
            await sendNext(agentId, current);
          }
        }
        prune(agentId);
      });
    },

    async sweep() {
      const candidates = [...agents.entries()]
        .filter(([, current]) => current.prompts.length > 0 && current.paused === null)
        .map(([agentId]) => agentId);

      await Promise.allSettled(
        candidates.map((agentId) =>
          exclusive(agentId, async () => {
            const current = agents.get(agentId);
            if (!current || current.prompts.length === 0 || current.paused !== null) {
              return;
            }
            if ((await availability(agentId, current)) === "busy") {
              return;
            }
            await sendNext(agentId, current);
          }),
        ),
      );
    },

    remove(agentId, promptId) {
      return exclusive(agentId, async () => {
        const current = agents.get(agentId);
        if (!current) {
          return;
        }

        current.prompts = current.prompts.filter(({ id }) => id !== promptId);
        if (current.prompts.length === 0) {
          current.paused = null;
        }
        prune(agentId);
      });
    },

    resume(agentId) {
      return exclusive(agentId, async () => {
        const current = agents.get(agentId);
        if (!current) {
          return;
        }

        current.paused = null;
        if ((await availability(agentId, current)) === "idle") {
          await sendNext(agentId, current);
        }
        prune(agentId);
      });
    },

    forget(agentId) {
      return exclusive(agentId, async () => {
        agents.delete(agentId);
      });
    },

    hasQueuedPrompts() {
      return [...agents.values()].some(({ prompts }) => prompts.length > 0);
    },

    snapshot() {
      const queues: AgentQueue[] = [];
      for (const [agentId, current] of agents) {
        if (current.prompts.length > 0) {
          queues.push({
            agentId,
            paused: current.paused,
            prompts: current.prompts.map((prompt) => ({ ...prompt })),
          });
        }
      }
      return { queues };
    },
  };
}
