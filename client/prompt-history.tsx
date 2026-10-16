import type {
  PluginAgentPanelProps,
  PluginButtonContentProps,
} from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import {
  FlatList,
  Icon,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { FlatList as NativeFlatList } from "react-native";
import { errorMessage, formatPrompt } from "./format";
import { deduplicatePrompts, rankPrompts, type RankedPrompt } from "./fuzzy";
import type { PromptRecord } from "./history";
import { searchLabel } from "./labels";
import { loadPromptHistory } from "./load";
import type { QueueStore } from "./queue";
import { QueuedPrompts, useAgentBusy } from "./queued-prompts";
import { moveSelection, selectedIndex } from "./selection";

const HOST_FOCUS_SETTLE_DELAY_MS = 200;

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

function PromptHistoryContent({
  theme,
  layout,
  queues,
  agentId,
  onClose,
}: {
  theme: Theme;
  layout: Layout;
  queues: QueueStore;
  agentId: string;
  onClose: () => void;
}) {
  const paseo = usePaseo();
  const toast = useToast();
  const searchRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const editorRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const resultsRef = useRef<NativeFlatList<RankedPrompt>>(null);
  const [query, setQuery] = useState("");
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const busy = useAgentBusy(queues, agentId);
  const [error, setError] = useState<string | null>(null);
  const matches = useMemo(() => rankPrompts(prompts, query), [prompts, query]);
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
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    setError(null);
    setPrompts([]);
    void loadPromptHistory(paseo, signal, (batch) => {
      setPrompts((current) => deduplicatePrompts([...current, ...batch]));
    })
      .catch((loadError: unknown) => {
        if (!signal.aborted) {
          setError(errorMessage(loadError, "Could not load prompt history."));
        }
      })
      .finally(() => {
        if (!signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [paseo]);

  useEffect(() => {
    const focusSearch = () => searchRef.current?.focus();

    focusSearch();
    const timer = setTimeout(focusSearch, HOST_FOCUS_SETTLE_DELAY_MS);
    return () => clearTimeout(timer);
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
    if (!text.trim()) {
      return;
    }

    try {
      const result = await queues.send(agentId, text);
      if (result === "queued") {
        toast.show("Prompt queued. It will send when the agent finishes its turn.", {
          variant: "success",
        });
      } else if (result === "sent") {
        toast.show("Prompt sent", { variant: "success" });
        onClose();
      }
    } catch (sendError: unknown) {
      toast.error(errorMessage(sendError, "Could not send prompt."));
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

      <QueuedPrompts theme={theme} queues={queues} agentId={agentId} />

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
            disabled={busy || !draft.trim()}
            onPress={() => void send(draft)}
            style={styles.send}
          >
            <Text style={styles.sendText}>{busy ? "Sending…" : "Send"}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** The components close over the store, so they need no context or global to reach it. */
export function createPromptHistory(queues: QueueStore) {
  function PromptHistoryPopover(props: PluginButtonContentProps) {
    if (props.context !== "agent") {
      return null;
    }

    return (
      <PromptHistoryContent
        theme={props.theme}
        layout={props.layout}
        queues={queues}
        agentId={props.agentId}
        onClose={props.close}
      />
    );
  }

  function PromptHistoryPanel({ theme, layout, agentId }: PluginAgentPanelProps) {
    return (
      <PromptHistoryContent
        theme={theme}
        layout={layout}
        queues={queues}
        agentId={agentId}
        onClose={() => {}}
      />
    );
  }

  return { PromptHistoryPopover, PromptHistoryPanel };
}
