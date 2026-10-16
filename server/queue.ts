import type { AgentQueue, QueuedPrompt, QueueSnapshot } from "../shared/queue";

export type TurnOutcome = { kind: "completed" } | { kind: "failed" } | { kind: "canceled" };

export type PromptQueueDeps = {
  /** Resolves when the daemon accepts the prompt. */
  send(agentId: string, text: string, messageId: string): Promise<void>;
  /** Reads the daemon's current view of the agent. */
  isBusy(agentId: string): Promise<boolean>;
  newId(): string;
  now(): number;
};

export type PromptQueue = {
  send(agentId: string, text: string): Promise<"sent" | "queued">;
  turnStarted(agentId: string): Promise<void>;
  turnEnded(agentId: string, outcome: TurnOutcome): Promise<void>;
  /** Fallback for missed turn events: drains queues whose agent is idle. */
  sweep(): Promise<void>;
  remove(agentId: string, promptId: string): Promise<void>;
  resume(agentId: string): Promise<void>;
  forget(agentId: string): Promise<void>;
  hasQueuedPrompts(): boolean;
  snapshot(): QueueSnapshot;
};

type AgentState = {
  prompts: QueuedPrompt[];
  paused: string | null;
  /** Set while a turn is known to run, from a turn event or our own send. */
  turnSince: number | null;
};

// A sent prompt can take a moment to show as running. Until this time passes,
// the sweep trusts our own record of the turn over the daemon's status.
export const TURN_START_GRACE_MS = 60_000;

export function createPromptQueue(deps: PromptQueueDeps): PromptQueue {
  const agents = new Map<string, AgentState>();
  const locks = new Map<string, Promise<void>>();

  function state(agentId: string): AgentState {
    let current = agents.get(agentId);
    if (!current) {
      current = { prompts: [], paused: null, turnSince: null };
      agents.set(agentId, current);
    }
    return current;
  }

  function prune(agentId: string): void {
    const current = agents.get(agentId);
    if (current && current.prompts.length === 0 && current.turnSince === null) {
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
    current.turnSince = deps.now();
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
            current.turnSince !== null ||
            (await deps.isBusy(agentId))
          ) {
            current.prompts.push({
              id: deps.newId(),
              text,
              queuedAt: new Date(deps.now()).toISOString(),
            });
            return "queued";
          }

          await deps.send(agentId, text, deps.newId());
          current.turnSince = deps.now();
          return "sent";
        } finally {
          prune(agentId);
        }
      });
    },

    turnStarted(agentId) {
      return exclusive(agentId, async () => {
        state(agentId).turnSince = deps.now();
      });
    },

    turnEnded(agentId, outcome) {
      return exclusive(agentId, async () => {
        const current = agents.get(agentId);
        if (!current) {
          return;
        }

        current.turnSince = null;
        if (current.prompts.length > 0 && current.paused === null) {
          if (outcome.kind === "canceled") {
            current.paused = "Paused because the turn was stopped.";
          } else if (outcome.kind === "failed") {
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
            if (
              current.turnSince !== null &&
              deps.now() - current.turnSince < TURN_START_GRACE_MS
            ) {
              return;
            }
            if (await deps.isBusy(agentId)) {
              return;
            }

            current.turnSince = null;
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
        if (current.turnSince === null && !(await deps.isBusy(agentId))) {
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
