import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buttonSelector,
  chooseVisibleElement,
  openPromptHistory,
  searchSelector,
  type PromptHistoryElement,
} from "../../client/element.ts";

function fakeElement(visible = true) {
  const calls: string[] = [];
  const element: PromptHistoryElement = {
    click: () => calls.push("click"),
    focus: () => calls.push("focus"),
    getClientRects: () => ({ length: visible ? 1 : 0 }),
  };
  return { element, calls };
}

function page(elements: Record<string, PromptHistoryElement[]>) {
  return (selector: string) => elements[selector] ?? [];
}

test("only a single visible element is chosen", () => {
  const hidden = fakeElement(false).element;
  const visible = fakeElement().element;

  assert.equal(chooseVisibleElement([hidden, visible]), visible);
  assert.equal(chooseVisibleElement([visible, fakeElement().element]), null);
});

test("the shortcut opens the history button", () => {
  const button = fakeElement();

  assert.equal(openPromptHistory(page({ [buttonSelector]: [button.element] })), true);
  assert.deepEqual(button.calls, ["click"]);
});

test("the shortcut focuses a search field that is already open", () => {
  const search = fakeElement();
  const button = fakeElement();

  const handled = openPromptHistory(
    page({ [searchSelector]: [search.element], [buttonSelector]: [button.element] }),
  );

  assert.equal(handled, true);
  assert.deepEqual(search.calls, ["focus"]);
  assert.deepEqual(button.calls, []);
});

test("the shortcut reports when it cannot open history", () => {
  const twoComposers = page({ [buttonSelector]: [fakeElement().element, fakeElement().element] });

  assert.equal(openPromptHistory(page({})), false);
  assert.equal(openPromptHistory(twoComposers), false);
});
