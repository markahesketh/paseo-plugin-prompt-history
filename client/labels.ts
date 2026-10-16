/** The hotkey finds these elements by their accessible names, so the UI and element.ts share them. */
export const historyTitle = "Search prompt history";
export const searchLabel = "Search previous prompts";

/** The title is the pill's accessible name and must not change; only the visible label shows the count. */
export function pillText(queuedCount: number): { title: string; label: string } {
  return {
    title: historyTitle,
    label: queuedCount === 0 ? "History" : `History · ${queuedCount} queued`,
  };
}
