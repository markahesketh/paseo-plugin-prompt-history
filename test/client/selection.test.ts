import { test } from "node:test";
import assert from "node:assert/strict";
import { moveSelection, selectedIndex } from "../../client/selection.ts";

test("the selection stays on the same prompt when a new batch ranks above it", () => {
  const before = [{ id: "a" }, { id: "b" }];
  const selected = moveSelection(before, null, 1);

  const after = [{ id: "new" }, { id: "a" }, { id: "b" }];

  assert.equal(after[selectedIndex(after, selected)]!.id, "b");
});

test("the selection stops at the ends of the list", () => {
  const items = [{ id: "a" }, { id: "b" }];

  assert.equal(moveSelection(items, "a", -1), "a");
  assert.equal(moveSelection(items, "b", 1), "b");
});

test("the first result is selected when the selected prompt is gone", () => {
  assert.equal(selectedIndex([{ id: "a" }], "missing"), 0);
});
