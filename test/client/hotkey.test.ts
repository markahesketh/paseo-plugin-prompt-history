import { test } from "node:test";
import assert from "node:assert/strict";
import { isPromptHistoryHotkey } from "../../client/hotkey.ts";

test("Ctrl+R matches in any letter case and keyboard layout", () => {
  assert.equal(isPromptHistoryHotkey({ ctrlKey: true, key: "r" }), true);
  assert.equal(isPromptHistoryHotkey({ ctrlKey: true, key: "R" }), true);
  assert.equal(isPromptHistoryHotkey({ ctrlKey: true, key: "к", code: "KeyR" }), true);
});

test("other modifiers, repeats, and handled events do not match", () => {
  assert.equal(isPromptHistoryHotkey({ ctrlKey: false, key: "r" }), false);
  assert.equal(isPromptHistoryHotkey({ ctrlKey: true, metaKey: true, key: "r" }), false);
  assert.equal(isPromptHistoryHotkey({ ctrlKey: true, shiftKey: true, key: "r" }), false);
  assert.equal(isPromptHistoryHotkey({ ctrlKey: true, altKey: true, key: "r" }), false);
  assert.equal(isPromptHistoryHotkey({ ctrlKey: true, repeat: true, key: "r" }), false);
  assert.equal(isPromptHistoryHotkey({ ctrlKey: true, defaultPrevented: true, key: "r" }), false);
});
