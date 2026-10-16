import { test } from "node:test";
import assert from "node:assert/strict";
import { daemonStatus, type AgentView } from "../../server/daemon-status.ts";

const turn = { turnId: "turn-1", startedAt: null };

test("maps the daemon's view of an agent to the queue's status", () => {
  const cases: [AgentView | null, ReturnType<typeof daemonStatus>][] = [
    [{ status: "idle", activeTurn: null }, "idle"],
    [{ status: "error", activeTurn: null }, "idle"],
    [{ status: "closed", activeTurn: null }, "idle"],
    [{ status: "running", activeTurn: null }, "busy"],
    [{ status: "initializing", activeTurn: null }, "busy"],
    [{ status: "idle", activeTurn: turn }, "busy"],
    [{ status: "idle", activeTurn: null, archivedAt: "2026-10-16T09:00:00.000Z" }, "gone"],
    [null, "gone"],
  ];
  for (const [agent, expected] of cases) {
    assert.equal(daemonStatus(agent && { agent }), expected, JSON.stringify(agent));
  }
});
