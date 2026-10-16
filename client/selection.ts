type Identified = { id: string };

/**
 * Results arrive in batches and are ranked again each time. Selection follows
 * the prompt, not the row, so Enter sends the prompt that is highlighted.
 */
export function selectedIndex(items: readonly Identified[], selectedId: string | null): number {
  const index = selectedId === null ? -1 : items.findIndex(({ id }) => id === selectedId);
  return index < 0 ? 0 : index;
}

export function moveSelection(
  items: readonly Identified[],
  selectedId: string | null,
  delta: number,
): string | null {
  if (items.length === 0) {
    return null;
  }

  const next = Math.min(Math.max(selectedIndex(items, selectedId) + delta, 0), items.length - 1);
  return items[next]!.id;
}
