import { createPromptSendQueue } from "./send.ts";

function assertEqual<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

type FakeAgent = {
  status: "idle" | "running";
  activeTurn: unknown | null;
  send(text: string): Promise<void>;
};

const sent: string[] = [];
const agent: FakeAgent = {
  status: "running",
  activeTurn: { id: "turn-1" },
  async send(text) {
    sent.push(text);
  },
};
const paseo = { agents: { ref: () => agent } } as never;
const queue = createPromptSendQueue(paseo);
const queueUpdates: number[] = [];
const removeQueueListener = queue.subscribe((_agentId, messages) => {
  queueUpdates.push(messages.length);
});

assertEqual(await queue.send("agent-1", "queued prompt"), "queued");
assertEqual(sent, []);
assertEqual(queueUpdates, [1]);

agent.status = "idle";
agent.activeTurn = null;
queue.observe({ id: "agent-1", status: agent.status, activeTurn: agent.activeTurn });
await new Promise<void>((resolve) => setTimeout(resolve, 0));

assertEqual(sent, ["queued prompt"]);
assertEqual(queueUpdates, [1, 0]);
removeQueueListener();
queue.dispose();

console.log("send queue tests passed");
