import type { PaseoAgent } from "@getpaseo/client";
import type { DaemonStatus } from "./queue";

export type AgentView = Pick<PaseoAgent, "status" | "activeTurn">;

export function daemonStatus(agent: AgentView): DaemonStatus {
  const { status, activeTurn } = agent;
  return status === "running" || status === "initializing" || activeTurn != null
    ? "busy"
    : "idle";
}
