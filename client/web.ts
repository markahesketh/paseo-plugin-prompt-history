import { Platform } from "react-native";
import { chooseVisibleElement } from "./element";
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
  target?: PromptHistoryElement | null;
};

type PromptHistoryElement = {
  click(): void;
  focus(): void;
  select?(): void;
  closest?(selector: string): PromptHistoryElement | null;
  getClientRects?(): { length: number };
};

type PromptHistoryElementList = {
  length: number;
  [index: number]: PromptHistoryElement;
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
  requestAnimationFrame(callback: () => void): number;
};

declare const document: {
  querySelectorAll(selector: string): PromptHistoryElementList;
};

const searchSelector = '[aria-label="Search previous prompts"]';
const buttonSelector =
  'button[aria-label="Search prompt history"], button[title="Search prompt history"], [role="button"][aria-label="Search prompt history"]';

function onlyElement(selector: string): PromptHistoryElement | null {
  const elements = document.querySelectorAll(selector);
  return chooseVisibleElement(Array.from(elements));
}

function focusSearchInput(): boolean {
  const input = onlyElement(searchSelector);
  if (!input) {
    return false;
  }

  input.focus();
  input.select?.();
  return true;
}

function focusSearchInputWhenReady(attempt = 0): void {
  if (focusSearchInput() || attempt >= 5) {
    return;
  }

  window.requestAnimationFrame(() => focusSearchInputWhenReady(attempt + 1));
}

function openPromptHistory(): void {
  if (focusSearchInput()) {
    return;
  }

  const button = onlyElement(buttonSelector);
  if (!button) {
    return;
  }

  button.click();
  focusSearchInputWhenReady();
}

export function installPromptHistoryHotkey(): () => void {
  if (Platform.OS !== "web") {
    return () => {};
  }

  const handleKeyDown = (event: PromptHistoryKeyEvent) => {
    if (!isPromptHistoryHotkey(event) || event.target?.closest?.(".xterm")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openPromptHistory();
  };

  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}
