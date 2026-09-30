export type VisibleElement = {
  getClientRects?(): { length: number };
};

export function chooseVisibleElement<T extends VisibleElement>(elements: readonly T[]): T | null {
  const visible = elements.filter((element) => {
    const rects = element.getClientRects?.();
    return rects === undefined || rects.length > 0;
  });

  return visible.length === 1 ? visible[0] : null;
}
