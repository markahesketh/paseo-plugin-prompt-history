import { test } from "node:test";
import assert from "node:assert/strict";
import { buttonSelector, searchSelector } from "../../client/element.ts";
import { pillText, searchLabel } from "../../client/labels.ts";

for (const queuedCount of [0, 3]) {
  test(`the hotkey selector matches the pill title with ${queuedCount} queued`, () => {
    const { title } = pillText(queuedCount);

    assert.ok(buttonSelector.includes(`[aria-label="${title}"]`), title);
  });
}

test("the pill label shows the queued count", () => {
  assert.equal(pillText(0).label, "History");
  assert.equal(pillText(3).label, "History · 3 queued");
});

test("the hotkey selector matches the search field label", () => {
  assert.ok(searchSelector.includes(`"${searchLabel}"`));
});
