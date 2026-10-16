import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { QueueSnapshot } from "../../shared/queue.ts";
import { createQueueStore, type QueueApi } from "../../client/queue.ts";

function snapshotWith(count: number): QueueSnapshot {
  return {
    queues: [
      {
        agentId: "agent",
        paused: null,
        prompts: Array.from({ length: count }, (_, index) => ({
          id: `prompt-${index}`,
          text: `prompt ${index}`,
          queuedAt: "2026-10-02T10:00:00.000Z",
        })),
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Every call waits for the test to settle it, so responses can arrive in any order. */
function controlledApi() {
  const calls = {
    list: [] as ReturnType<typeof deferred<QueueSnapshot>>[],
    send: [] as ReturnType<typeof deferred<{ result: "sent" | "queued"; snapshot: QueueSnapshot }>>[],
    remove: [] as ReturnType<typeof deferred<QueueSnapshot>>[],
    resume: [] as ReturnType<typeof deferred<QueueSnapshot>>[],
  };
  const api: QueueApi = {
    list: () => {
      const call = deferred<QueueSnapshot>();
      calls.list.push(call);
      return call.promise;
    },
    send: () => {
      const call = deferred<{ result: "sent" | "queued"; snapshot: QueueSnapshot }>();
      calls.send.push(call);
      return call.promise;
    },
    remove: () => {
      const call = deferred<QueueSnapshot>();
      calls.remove.push(call);
      return call.promise;
    },
    resume: () => {
      const call = deferred<QueueSnapshot>();
      calls.resume.push(call);
      return call.promise;
    },
  };
  return { api, calls };
}

function openStore(t: TestContext) {
  const controlled = controlledApi();
  const store = createQueueStore(controlled.api);
  t.after(() => store.dispose());
  return { store, ...controlled };
}

test("a mutation's snapshot is not replaced by a refresh that was already in flight", async (t) => {
  const { store, calls } = openStore(t);

  const refreshing = store.refresh();
  const sending = store.send("agent", "hello");
  calls.send[0]!.resolve({ result: "queued", snapshot: snapshotWith(2) });
  await sending;
  calls.list.forEach((call) => call.resolve(snapshotWith(5)));
  await refreshing;

  assert.equal(store.get("agent")?.prompts.length, 2);
});

test("a second mutation for the same agent is ignored while one is in flight", async (t) => {
  const { store, calls } = openStore(t);

  const removing = store.remove("agent", "prompt-0");
  const resuming = store.resume("agent");
  const busyWhileInFlight = store.busy("agent");
  calls.remove[0]!.resolve(snapshotWith(1));
  await Promise.all([removing, resuming]);

  assert.equal(busyWhileInFlight, true);
  assert.equal(calls.remove.length, 1);
  assert.equal(calls.resume.length, 0);
  assert.equal(store.busy("agent"), false);
  assert.equal(store.get("agent")?.prompts.length, 1);
});

test("a failed mutation rejects, leaves the queue alone, and frees the agent", async (t) => {
  const { store, calls } = openStore(t);

  const removing = store.remove("agent", "prompt-0");
  calls.remove[0]!.reject(new Error("daemon offline"));

  await assert.rejects(removing, /daemon offline/);
  assert.equal(store.busy("agent"), false);
  assert.equal(store.get("agent"), null);
});

test("refreshSoon turns a burst of calls into one refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, calls } = openStore(t);
  const initialRefreshes = calls.list.length;

  store.refreshSoon();
  store.refreshSoon();
  t.mock.timers.tick(1_000);

  assert.equal(calls.list.length, initialRefreshes + 1);
});
