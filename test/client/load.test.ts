import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { PromptEntry, PromptRecord } from "../../client/history.ts";
import { loadPromptHistory, type Paseo } from "../../client/load.ts";

type DirectoryPage = {
  agents: { id: string; updatedAt: string }[];
  nextCursor?: string;
};
type TimelinePage = {
  entries: PromptEntry[];
  startCursor?: string;
  error?: string;
};

/** Scripted pages keyed by the cursor the loader sends; "" is the first page. */
function fakePaseo(script: {
  directory: Record<string, DirectoryPage | Error>;
  timelines: Record<string, Record<string, TimelinePage>>;
}) {
  const directoryCursors: string[] = [];
  const refetches: { agentId: string; cursor: string }[] = [];

  const paseo = {
    agents: {
      async list(options: { page: { cursor?: string } }) {
        const cursor = options.page.cursor ?? "";
        directoryCursors.push(cursor);
        const page = script.directory[cursor];
        if (page instanceof Error) {
          throw page;
        }
        if (!page) {
          throw new Error(`no directory page for cursor "${cursor}"`);
        }
        return {
          entries: page.agents.map(({ id, updatedAt }) => ({ agent: { id, title: id, updatedAt } })),
          pageInfo: { hasMore: page.nextCursor !== undefined, nextCursor: page.nextCursor ?? null },
        };
      },
      ref: (agentId: string) => ({
        timeline: {
          async refetch(options: { cursor?: string }) {
            const cursor = options.cursor ?? "";
            refetches.push({ agentId, cursor });
            const page = script.timelines[agentId]?.[cursor];
            if (!page) {
              throw new Error(`no timeline page for ${agentId} at "${cursor}"`);
            }
            return {
              entries: page.entries,
              hasOlder: page.startCursor !== undefined,
              startCursor: page.startCursor ?? null,
              error: page.error ?? null,
            };
          },
        },
      }),
    },
  };

  return { paseo: paseo as unknown as Paseo, directoryCursors, refetches };
}

function prompt(text: string, seqStart: number): PromptEntry {
  return { item: { type: "user_message", text }, timestamp: "2026-10-01T10:00:00.000Z", seqStart };
}

function singleAgent(id: string, updatedAt: string, pages: Record<string, TimelinePage>) {
  return fakePaseo({
    directory: { "": { agents: [{ id, updatedAt }] } },
    timelines: { [id]: pages },
  });
}

function start() {
  const controller = new AbortController();
  const signal = { cancelled: false, abortSignal: controller.signal };
  return {
    signal,
    abort() {
      signal.cancelled = true;
      controller.abort();
    },
  };
}

async function load(paseo: Paseo, session = start()): Promise<PromptRecord[][]> {
  const batches: PromptRecord[][] = [];
  await loadPromptHistory(paseo, session.signal, (batch) => batches.push(batch));
  return batches;
}

const texts = (batches: PromptRecord[][]) => batches.flat().map(({ text }) => text);

function silenceWarnings(t: TestContext) {
  t.mock.method(console, "warn", () => {});
}

test("an agent's prompts are read page by page from newest to oldest", async () => {
  const { paseo, refetches } = singleAgent("paged", "u1", {
    "": { entries: [prompt("newer", 2)], startCursor: "older" },
    older: { entries: [prompt("older", 1)] },
  });

  assert.deepEqual(texts(await load(paseo)), ["newer", "older"]);
  assert.deepEqual(refetches, [
    { agentId: "paged", cursor: "" },
    { agentId: "paged", cursor: "older" },
  ]);
});

test("cached prompts are reused until the agent's updatedAt changes", async () => {
  const pages = { "": { entries: [prompt("cached", 1)] } };
  const first = singleAgent("cache", "u1", pages);
  const same = singleAgent("cache", "u1", pages);
  const changed = singleAgent("cache", "u2", pages);

  await load(first.paseo);
  const reused = await load(same.paseo);
  await load(changed.paseo);

  assert.deepEqual(texts(reused), ["cached"]);
  assert.equal(first.refetches.length, 1);
  assert.equal(same.refetches.length, 0);
  assert.equal(changed.refetches.length, 1);
});

test("a failure on a later page keeps the newer pages and is read again next time", async (t) => {
  silenceWarnings(t);
  const pages = {
    "": { entries: [prompt("newer", 2)], startCursor: "older" },
    older: { entries: [], error: "timeline unavailable" },
  };
  const first = singleAgent("partial", "u1", pages);
  const second = singleAgent("partial", "u1", pages);

  assert.deepEqual(texts(await load(first.paseo)), ["newer"]);
  await load(second.paseo);

  assert.equal(second.refetches.length, 2);
});

test("a failure on the first page skips that agent, is not cached, and leaves the others loaded", async (t) => {
  silenceWarnings(t);
  const failing = { "": { entries: [], error: "timeline unavailable" } };
  const build = () =>
    fakePaseo({
      directory: {
        "": {
          agents: [
            { id: "broken", updatedAt: "u1" },
            { id: "fine", updatedAt: "u1" },
          ],
        },
      },
      timelines: { broken: failing, fine: { "": { entries: [prompt("fine prompt", 1)] } } },
    });
  const first = build();
  const second = build();

  assert.deepEqual(texts(await load(first.paseo)), ["fine prompt"]);
  await load(second.paseo);

  assert.equal(second.refetches.filter(({ agentId }) => agentId === "broken").length, 1);
});

test("a directory failure rejects the load", async () => {
  const { paseo } = fakePaseo({ directory: { "": new Error("offline") }, timelines: {} });

  await assert.rejects(load(paseo), /offline/);
});

test("directory pagination follows cursors and stops on a repeated one", async () => {
  const { paseo, directoryCursors } = fakePaseo({
    directory: {
      "": { agents: [{ id: "dir-a", updatedAt: "u1" }], nextCursor: "next" },
      next: { agents: [{ id: "dir-b", updatedAt: "u1" }], nextCursor: "next" },
    },
    timelines: {
      "dir-a": { "": { entries: [prompt("from a", 1)] } },
      "dir-b": { "": { entries: [prompt("from b", 1)] } },
    },
  });

  assert.deepEqual((await load(paseo)).flat().map(({ text }) => text).sort(), ["from a", "from b"]);
  assert.deepEqual(directoryCursors, ["", "next"]);
});

test("aborting before the load starts reads nothing", async () => {
  const { paseo, directoryCursors } = singleAgent("never", "u1", {});
  const session = start();
  session.abort();

  assert.deepEqual(await load(paseo, session), []);
  assert.deepEqual(directoryCursors, []);
});

test("aborting during the load stops delivering batches and reading agents", async () => {
  const ids = Array.from({ length: 8 }, (_, index) => `abort-${index}`);
  const { paseo, refetches } = fakePaseo({
    directory: { "": { agents: ids.map((id) => ({ id, updatedAt: "u1" })) } },
    timelines: Object.fromEntries(ids.map((id) => [id, { "": { entries: [prompt(id, 1)] } }])),
  });
  const session = start();
  const batches: PromptRecord[][] = [];

  await loadPromptHistory(paseo, session.signal, (batch) => {
    batches.push(batch);
    session.abort();
  });

  assert.equal(batches.length, 1);
  assert.ok(refetches.length < ids.length, `${refetches.length} agents were read`);
});
