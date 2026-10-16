import { Platform } from "react-native";
import { openPromptHistory, type PromptHistoryElement } from "./element";
import { isPromptHistoryHotkey } from "./hotkey";

type PromptHistoryKeyEvent = {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  repeat: boolean;
  key: string;
  code: string;
  preventDefault(): void;
  stopPropagation(): void;
  target?: { closest?(selector: string): unknown } | null;
};

declare const window: {
  addEventListener(
    type: "keydown",
    listener: (event: PromptHistoryKeyEvent) => void,
    capture: boolean,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: PromptHistoryKeyEvent) => void,
    capture: boolean,
  ): void;
};

declare const document: {
  querySelectorAll(selector: string): ArrayLike<PromptHistoryElement>;
};

export function installPromptHistoryHotkey(): () => void {
  if (Platform.OS !== "web") {
    return () => {};
  }

  const handleKeyDown = (event: PromptHistoryKeyEvent) => {
    if (!isPromptHistoryHotkey(event) || event.target?.closest?.(".xterm")) {
      return;
    }

    if (openPromptHistory((selector) => document.querySelectorAll(selector))) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}
