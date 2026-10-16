export const historyTitle = "Search prompt history";
export const searchLabel = "Search previous prompts";

export function pillText(queuedCount: number): { title: string; label: string } {
  return {
    title: historyTitle,
    label: queuedCount === 0 ? "History" : `History · ${queuedCount} queued`,
  };
}
