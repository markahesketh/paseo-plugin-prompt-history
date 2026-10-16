import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const queuedPrompt = z.object({
  id: z.string(),
  text: z.string(),
  queuedAt: z.string(),
});

const agentQueue = z.object({
  agentId: z.string(),
  paused: z.string().nullable(),
  prompts: z.array(queuedPrompt),
});

const queueSnapshot = z.object({ queues: z.array(agentQueue) });

export type QueuedPrompt = z.infer<typeof queuedPrompt>;
export type AgentQueue = z.infer<typeof agentQueue>;
export type QueueSnapshot = z.infer<typeof queueSnapshot>;

export const sendPromptRpc = defineRpc({
  name: "prompt-history.send",
  input: z.object({
    agentId: z.string().min(1),
    text: z.string().refine((text) => text.trim().length > 0, "Prompt is empty."),
  }),
  output: z.object({
    result: z.enum(["sent", "queued"]),
    snapshot: queueSnapshot,
  }),
});

export const listQueuesRpc = defineRpc({
  name: "prompt-history.queues.list",
  input: z.object({}),
  output: queueSnapshot,
});

export const removeQueuedPromptRpc = defineRpc({
  name: "prompt-history.queues.remove",
  input: z.object({ agentId: z.string().min(1), promptId: z.string().min(1) }),
  output: queueSnapshot,
});

export const resumeQueueRpc = defineRpc({
  name: "prompt-history.queues.resume",
  input: z.object({ agentId: z.string().min(1) }),
  output: queueSnapshot,
});
