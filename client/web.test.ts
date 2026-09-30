import { chooseVisibleElement } from "./element.ts";

function assertEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error("Expected the visible element to be selected.");
  }
}

const hidden = { getClientRects: () => ({ length: 0 }) };
const visible = { getClientRects: () => ({ length: 1 }) };
const anotherVisible = { getClientRects: () => ({ length: 1 }) };

assertEqual(chooseVisibleElement([hidden, visible]), visible);
assertEqual(chooseVisibleElement([visible, anotherVisible]), null);

console.log("web tests passed");
