import { isPromptHistoryHotkey } from "./hotkey.ts";

function assertEqual(actual: boolean, expected: boolean): void {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

assertEqual(isPromptHistoryHotkey({ ctrlKey: true, key: "r" }), true);
assertEqual(isPromptHistoryHotkey({ ctrlKey: true, key: "R" }), true);
assertEqual(isPromptHistoryHotkey({ ctrlKey: true, key: "к", code: "KeyR" }), true);
assertEqual(isPromptHistoryHotkey({ ctrlKey: false, key: "r" }), false);
assertEqual(isPromptHistoryHotkey({ ctrlKey: true, metaKey: true, key: "r" }), false);
assertEqual(isPromptHistoryHotkey({ ctrlKey: true, shiftKey: true, key: "r" }), false);
assertEqual(isPromptHistoryHotkey({ ctrlKey: true, altKey: true, key: "r" }), false);
assertEqual(isPromptHistoryHotkey({ ctrlKey: true, repeat: true, key: "r" }), false);
assertEqual(isPromptHistoryHotkey({ ctrlKey: true, defaultPrevented: true, key: "r" }), false);
