export type VisibleElement = {
  getClientRects?(): { length: number };
};

export type PromptHistoryElement = VisibleElement & {
  click(): void;
  focus?(): void;
};

export type ElementQuery = (selector: string) => ArrayLike<PromptHistoryElement>;

export const searchSelector = '[aria-label="Search previous prompts"]';
export const buttonSelector =
  'button[aria-label="Search prompt history"], button[title="Search prompt history"], [role="button"][aria-label="Search prompt history"]';

export function chooseVisibleElement<T extends VisibleElement>(elements: readonly T[]): T | null {
  const visible = elements.filter((element) => {
    const rects = element.getClientRects?.();
    return rects === undefined || rects.length > 0;
  });

  return visible.length === 1 ? visible[0] : null;
}

/** Returns false when nothing was opened or focused, so the key can keep its normal meaning. */
export function openPromptHistory(query: ElementQuery): boolean {
  const search = chooseVisibleElement(Array.from(query(searchSelector)));
  if (search) {
    search.focus?.();
    return true;
  }

  const button = chooseVisibleElement(Array.from(query(buttonSelector)));
  if (!button) {
    return false;
  }

  button.click();
  return true;
}
