import type { usePaseo } from "@getpaseo/plugin/client";
import { promptsFromTimeline, type PromptRecord } from "./history.ts";

const PAGE_SIZE = 100;
const MAX_PAGES_PER_AGENT = 20;
const MAX_CONCURRENT_AGENT_LOADS = 4;

export type Paseo = ReturnType<typeof usePaseo>;
type Timeline = ReturnType<Paseo["agents"]["ref"]>["timeline"];
type TimelineRefetchOptions = NonNullable<Parameters<Timeline["refetch"]>[0]>;
type TimelineCursor = NonNullable<TimelineRefetchOptions["cursor"]>;
type AgentDirectoryEntry = Awaited<ReturnType<Paseo["agents"]["list"]>>["entries"][number];

const promptCache = new Map<string, { updatedAt: string; prompts: PromptRecord[] }>();

async function loadAgentPrompts(
  paseo: Paseo,
  agent: AgentDirectoryEntry["agent"],
  signal: AbortSignal,
): Promise<PromptRecord[]> {
  const cached = promptCache.get(agent.id);
  if (cached?.updatedAt === agent.updatedAt) {
    return cached.prompts;
  }

  const timeline = paseo.agents.ref(agent.id).timeline;
  const prompts: PromptRecord[] = [];
  let cursor: TimelineCursor | undefined;
  let cacheable = true;

  for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_AGENT; pageNumber += 1) {
    if (signal.aborted) {
      return [];
    }

    const page = await timeline.refetch({
      direction: "before",
      limit: PAGE_SIZE,
      projection: "projected",
      ...(cursor === undefined ? {} : { cursor }),
    });

    if (page.error) {
      if (pageNumber === 0) {
        throw new Error(page.error);
      }
      console.warn(`Could not read older prompt history for ${agent.id}`, page.error);
      cacheable = false;
      break;
    }

    prompts.push(...promptsFromTimeline(agent, page.entries));

    if (!page.hasOlder || page.startCursor === null || page.startCursor === undefined) {
      break;
    }
    cursor = page.startCursor;
  }

  if (cacheable && !signal.aborted) {
    promptCache.set(agent.id, { updatedAt: agent.updatedAt, prompts });
  }

  return prompts;
}

export async function loadPromptHistory(
  paseo: Paseo,
  signal: AbortSignal,
  onBatch: (prompts: PromptRecord[]) => void,
): Promise<void> {
  const agents: AgentDirectoryEntry[] = [];
  let cursor: string | undefined;

  do {
    if (signal.aborted) {
      return;
    }

    const directory = await paseo.agents.list({
      filter: { includeArchived: true },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
      signal,
    });
    agents.push(...directory.entries);

    const nextCursor = directory.pageInfo.nextCursor;
    if (!directory.pageInfo.hasMore || !nextCursor || nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
  } while (!signal.aborted);

  let nextAgent = 0;
  async function loadNextAgent(): Promise<void> {
    while (!signal.aborted) {
      const entry = agents[nextAgent];
      nextAgent += 1;
      if (!entry) {
        return;
      }

      try {
        const prompts = await loadAgentPrompts(paseo, entry.agent, signal);
        if (!signal.aborted && prompts.length > 0) {
          onBatch(prompts);
        }
      } catch (error) {
        if (!signal.aborted) {
          console.warn(`Could not read prompt history for ${entry.agent.id}`, error);
        }
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_AGENT_LOADS, agents.length) },
      () => loadNextAgent(),
    ),
  );
}
