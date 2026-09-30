export function isPromptHistoryHotkey(event: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  repeat?: boolean;
  key?: string;
  code?: string;
}): boolean {
  const usesR = event.code === "KeyR" || event.key?.toLocaleLowerCase() === "r";
  return (
    event.ctrlKey === true &&
    event.metaKey !== true &&
    event.shiftKey !== true &&
    event.altKey !== true &&
    event.defaultPrevented !== true &&
    event.repeat !== true &&
    usesR
  );
}
