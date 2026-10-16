import type { PaseoAgent } from "@getpaseo/client";
import type { DaemonStatus } from "./queue";

export type AgentView = Pick<PaseoAgent, "status" | "activeTurn" | "archivedAt">;

export function daemonStatus(result: { agent: AgentView } | null): DaemonStatus {
  if (!result) {
    throw new Error("Agent was not found.");
  }
  const { status, activeTurn } = result.agent;
  return status === "running" || status === "initializing" || activeTurn != null
    ? "busy"
    : "idle";
}
