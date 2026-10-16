import type {
  PluginAgentPanelProps,
  PluginButtonContentProps,
} from "@getpaseo/plugin/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import {
  FlatList,
  Icon,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { FlatList as NativeFlatList } from "react-native";
import {
  removeQueuedPromptRpc,
  resumeQueueRpc,
  sendPromptRpc,
  type AgentQueue,
  type QueueSnapshot,
} from "../shared/queue";
import { deduplicatePrompts, rankPrompts, type RankedPrompt } from "./fuzzy";
import type { PromptRecord } from "./history";
import { searchLabel } from "./labels";
import { loadPromptHistory } from "./load";
import { queueStore } from "./queue";
import { moveSelection, selectedIndex } from "./selection";

const HOST_FOCUS_SETTLE_DELAY_MS = 200;
const QUEUE_PREVIEW_COUNT = 3;

type Theme = PluginButtonContentProps["theme"];
type Layout = PluginButtonContentProps["layout"];

type KeyPress = {
  nativeEvent: {
    key?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    isComposing?: boolean;
  };
  preventDefault?: () => void;
};

function formatPrompt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function useAgentQueue(agentId: string): AgentQueue | null {
  const [queue, setQueue] = useState(() => queueStore()?.get(agentId) ?? null);

  useEffect(() => {
    const store = queueStore();
    setQueue(store?.get(agentId) ?? null);
    return store?.subscribe(() => setQueue(store.get(agentId)));
  }, [agentId]);

  return queue;
}

function QueuedPrompts({
  theme,
  queue,
  onChanged,
}: {
  theme: Theme;
  queue: AgentQueue;
  onChanged: (snapshot: QueueSnapshot) => void;
}) {
  const toast = useToast();
  const removeQueuedPrompt = useRpc(removeQueuedPromptRpc);
  const resumeQueue = useRpc(resumeQueueRpc);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<QueueSnapshot>, failure: string) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      onChanged(await action());
    } catch (error: unknown) {
      toast.error(errorMessage(error, failure));
    } finally {
      setBusy(false);
    }
  }

  const styles = {
    box: {
      padding: 10,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.surface2,
      gap: 6,
    },
    title: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },
    paused: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    text: { flex: 1, color: theme.colors.foreground, fontSize: 12, lineHeight: 16 },
    action: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Queued for this agent · {queue.prompts.length}</Text>
      {queue.paused ? (
        <View style={styles.row}>
          <Text style={styles.paused}>{queue.paused}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send the next queued prompt"
            disabled={busy}
            onPress={() =>
              void run(() => resumeQueue({ agentId: queue.agentId }), "Could not resume the queue.")
            }
          >
            <Text style={styles.action}>Send next</Text>
          </Pressable>
        </View>
      ) : null}
      {queue.prompts.slice(0, QUEUE_PREVIEW_COUNT).map((prompt) => (
        <View key={prompt.id} style={styles.row}>
          <Text numberOfLines={2} style={styles.text}>
            {formatPrompt(prompt.text)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove queued prompt: ${formatPrompt(prompt.text)}`}
            disabled={busy}
            onPress={() =>
              void run(
                () => removeQueuedPrompt({ agentId: queue.agentId, promptId: prompt.id }),
                "Could not remove the queued prompt.",
              )
            }
          >
            <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
      ))}
      {queue.prompts.length > QUEUE_PREVIEW_COUNT ? (
        <Text style={styles.text}>+{queue.prompts.length - QUEUE_PREVIEW_COUNT} more</Text>
      ) : null}
    </View>
  );
}

function PromptHistoryContent({
  theme,
  layout,
  agentId,
  onClose,
}: {
  theme: Theme;
  layout: Layout;
  agentId: string;
  onClose: () => void;
}) {
  const paseo = usePaseo();
  const toast = useToast();
  const sendPromptToQueue = useRpc(sendPromptRpc);
  const searchRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const editorRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const resultsRef = useRef<NativeFlatList<RankedPrompt>>(null);
  const [query, setQuery] = useState("");
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const queue = useAgentQueue(agentId);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const uniquePrompts = useMemo(() => deduplicatePrompts(prompts), [prompts]);
  const matches = useMemo(() => rankPrompts(uniquePrompts, query), [uniquePrompts, query]);
  const safeSelectedIndex = selectedIndex(matches, selectedId);
  const selected = matches[safeSelectedIndex];
  // Touch screens have no Tab key, and a tap can be a mistaken scroll, so a
  // tap opens the editor there. With a pointer, a click sends the prompt.
  const tapEdits = layout.platform !== "web" || layout.compact;
  // On compact layouts the host owns the only vertical scroller.
  const ownScroller = !layout.compact;

  const styles = useMemo(
    () => ({
      root: {
        width: layout.compact ? undefined : 400,
        minWidth: layout.compact ? undefined : 300,
        gap: 8,
      },
      search: {
        height: 36,
        paddingHorizontal: 10,
        paddingVertical: 0,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        color: theme.colors.foreground,
        fontSize: 14,
        lineHeight: 20,
        outlineWidth: 0,
        boxSizing: "border-box" as const,
      },
      hint: { color: theme.colors.foregroundMuted, fontSize: 11 },
      result: {
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 6,
        borderWidth: 1,
        gap: 3,
      },
      resultText: { color: theme.colors.foreground, fontSize: 13, lineHeight: 18 },
      resultMeta: { color: theme.colors.foregroundMuted, fontSize: 10, lineHeight: 14 },
      empty: { color: theme.colors.foregroundMuted, paddingVertical: 10, fontSize: 12 },
      results: { maxHeight: 320, flexGrow: 0 },
      plainResults: { gap: 4 },
      editor: {
        minHeight: 100,
        padding: 12,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        color: theme.colors.foreground,
        textAlignVertical: "top" as const,
        outlineWidth: 0,
        boxSizing: "border-box" as const,
      },
      send: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 7,
        backgroundColor: theme.colors.accent,
        alignSelf: "flex-end" as const,
      },
      sendText: { color: theme.colors.accentForeground, fontWeight: "600" as const },
    }),
    [layout.compact, theme],
  );

  // History covers every agent, so it does not depend on the selected agent.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const signal = { cancelled: false, abortSignal: controller.signal };
    setLoading(true);
    setError(null);
    setPrompts([]);
    void loadPromptHistory(paseo, signal, (batch) => {
      if (active) {
        setPrompts((current) => {
          const byId = new Map(current.map((prompt) => [prompt.id, prompt]));
          for (const prompt of batch) {
            byId.set(prompt.id, prompt);
          }
          return [...byId.values()];
        });
      }
    })
      .catch((loadError: unknown) => {
        if (active) {
          setError(errorMessage(loadError, "Could not load prompt history."));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      signal.cancelled = true;
      controller.abort();
    };
  }, [paseo]);

  useEffect(() => {
    let active = true;
    const focusSearch = () => {
      if (active) {
        searchRef.current?.focus();
      }
    };

    focusSearch();
    const timer = setTimeout(focusSearch, HOST_FOCUS_SETTLE_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    setSelectedId(null);
  }, [query]);

  // Hold the default selection on its prompt, so a later batch that ranks
  // above it does not change what Enter sends.
  useEffect(() => {
    if (selectedId === null && matches[0]) {
      setSelectedId(matches[0].id);
    }
  }, [matches, selectedId]);

  useEffect(() => {
    if (ownScroller && matches.length > 0) {
      resultsRef.current?.scrollToIndex({
        index: safeSelectedIndex,
        viewPosition: 0.5,
        animated: false,
      });
    }
  }, [ownScroller, matches.length, safeSelectedIndex]);

  async function send(text: string): Promise<void> {
    if (!text.trim() || sendingRef.current) {
      return;
    }

    sendingRef.current = true;
    setSending(true);
    try {
      const { result, snapshot } = await sendPromptToQueue({ agentId, text });
      queueStore()?.apply(snapshot);
      if (result === "queued") {
        toast.show("Prompt queued. It will send when the agent finishes its turn.", {
          variant: "success",
        });
      } else {
        toast.show("Prompt sent", { variant: "success" });
        onClose();
      }
    } catch (sendError: unknown) {
      toast.error(errorMessage(sendError, "Could not send prompt."));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function addToEditor(prompt: PromptRecord): void {
    setDraft(prompt.text);
    setEditing(true);
    setTimeout(() => editorRef.current?.focus(), 0);
  }

  function handleSearchKeyPress(event: KeyPress): void {
    const key = event.nativeEvent.key;
    if (key === "ArrowDown") {
      event.preventDefault?.();
      setSelectedId(moveSelection(matches, selected?.id ?? null, 1));
    } else if (key === "ArrowUp") {
      event.preventDefault?.();
      setSelectedId(moveSelection(matches, selected?.id ?? null, -1));
    } else if (key === "Enter" && !event.nativeEvent.isComposing && selected) {
      event.preventDefault?.();
      void send(selected.text);
    } else if (key === "Tab" && selected) {
      event.preventDefault?.();
      addToEditor(selected);
    }
  }

  function handleEditorKeyPress(event: KeyPress): void {
    if (
      event.nativeEvent.key === "Enter" &&
      !event.nativeEvent.isComposing &&
      (event.nativeEvent.ctrlKey === true || event.nativeEvent.metaKey === true)
    ) {
      event.preventDefault?.();
      void send(draft);
    }
  }

  function renderResult(prompt: RankedPrompt, index: number) {
    const active = index === safeSelectedIndex;
    return (
      <Pressable
        key={prompt.id}
        accessibilityLabel={formatPrompt(prompt.text)}
        accessibilityHint={tapEdits ? "Opens the prompt for editing" : "Sends the prompt"}
        role="button"
        aria-selected={active}
        onPress={() => {
          setSelectedId(prompt.id);
          if (tapEdits) {
            addToEditor(prompt);
          } else {
            void send(prompt.text);
          }
        }}
        style={{
          ...styles.result,
          backgroundColor: active ? theme.colors.surface2 : "transparent",
          borderColor: active ? theme.colors.accent : theme.colors.border,
          borderLeftWidth: active ? 2 : 1,
        }}
      >
        <Text numberOfLines={2} style={styles.resultText}>
          {formatPrompt(prompt.text)}
        </Text>
        <Text style={styles.resultMeta}>{prompt.agentLabel}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.root}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="History" size={16} color={theme.colors.foregroundMuted} />
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600" }}>
          Prompt history
        </Text>
      </View>
      <TextInput
        ref={searchRef}
        autoFocus
        accessibilityLabel={searchLabel}
        placeholder="Search previous prompts…"
        placeholderTextColor={theme.colors.foregroundMuted}
        value={query}
        onChangeText={setQuery}
        onKeyPress={handleSearchKeyPress}
        style={styles.search}
      />
      <Text style={styles.hint}>
        {layout.platform !== "web"
          ? "Tap a prompt to edit it, then send"
          : tapEdits
            ? "↑↓ choose · Enter send · Tab or click to edit · Cmd/Ctrl+Enter send"
            : "↑↓ choose · Enter send · Tab edit here · Cmd/Ctrl+Enter send"}
      </Text>

      {queue ? (
        <QueuedPrompts theme={theme} queue={queue} onChanged={(next) => queueStore()?.apply(next)} />
      ) : null}

      {loading ? <Text style={styles.empty}>Loading prompt history…</Text> : null}
      {error ? <Text style={styles.empty}>{error}</Text> : null}
      {!loading && !error && matches.length === 0 ? (
        <Text style={styles.empty}>{query ? "No matching prompts." : "No previous prompts found."}</Text>
      ) : null}
      {!error && matches.length > 0 ? (
        <View role="list" accessibilityLabel="Previous prompts">
          {ownScroller ? (
            <FlatList
              ref={resultsRef}
              data={matches}
              extraData={safeSelectedIndex}
              keyExtractor={(prompt) => prompt.id}
              keyboardShouldPersistTaps="handled"
              onScrollToIndexFailed={({ index, averageItemLength }) => {
                resultsRef.current?.scrollToOffset({
                  offset: averageItemLength * index,
                  animated: false,
                });
              }}
              style={styles.results}
              renderItem={({ item, index }) => renderResult(item, index)}
            />
          ) : (
            <View style={styles.plainResults}>{matches.map(renderResult)}</View>
          )}
        </View>
      ) : null}

      {editing ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Edit before sending</Text>
          <TextInput
            ref={editorRef}
            accessibilityLabel="Edit prompt before sending"
            multiline
            value={draft}
            onChangeText={setDraft}
            onKeyPress={handleEditorKeyPress}
            style={styles.editor}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send edited prompt"
            disabled={sending || !draft.trim()}
            onPress={() => void send(draft)}
            style={styles.send}
          >
            <Text style={styles.sendText}>{sending ? "Sending…" : "Send"}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function PromptHistoryPopover(props: PluginButtonContentProps) {
  if (props.context !== "agent") {
    return null;
  }

  return (
    <PromptHistoryContent
      theme={props.theme}
      layout={props.layout}
      agentId={props.agentId}
      onClose={props.close}
    />
  );
}

export function PromptHistoryPanel({
  theme,
  layout,
  agentId,
}: PluginAgentPanelProps) {
  return <PromptHistoryContent theme={theme} layout={layout} agentId={agentId} onClose={() => {}} />;
}
