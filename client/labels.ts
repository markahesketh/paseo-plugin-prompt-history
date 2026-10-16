/** The hotkey finds these elements by their accessible names, so the UI and element.ts share them. */
export const historyTitle = "Search prompt history";
export const searchLabel = "Search previous prompts";

export function pillText(queuedCount: number): { title: string; label: string } {
  return queuedCount === 0
    ? { title: historyTitle, label: "History" }
    : { title: `${historyTitle} (${queuedCount} queued)`, label: `History · ${queuedCount} queued` };
}
