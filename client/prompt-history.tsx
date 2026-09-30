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
import { rankPrompts, type PromptRecord } from "./fuzzy";
import { promptsFromTimeline } from "./history";
import { getQueuedPrompts, sendPrompt, subscribePromptQueue } from "./send";

const PAGE_SIZE = 100;
const MAX_PAGES_PER_AGENT = 20;
const MAX_CONCURRENT_AGENT_LOADS = 4;

type Paseo = ReturnType<typeof usePaseo>;
type Timeline = ReturnType<Paseo["agents"]["ref"]>["timeline"];
type TimelineRefetchOptions = NonNullable<Parameters<Timeline["refetch"]>[0]>;
type TimelineCursor = NonNullable<TimelineRefetchOptions["cursor"]>;
type AgentDirectoryEntry = Awaited<ReturnType<Paseo["agents"]["list"]>>["entries"][number];
type LoadSignal = { cancelled: boolean; abortSignal: AbortSignal };
type PromptBatchHandler = (prompts: PromptRecord[]) => void;

const promptCache = new Map<string, { updatedAt: string; prompts: PromptRecord[] }>();

type KeyPress = {
  nativeEvent: {
    key?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    isComposing?: boolean;
  };
  preventDefault?: () => void;
};

async function loadAgentPrompts(
  paseo: Paseo,
  agent: AgentDirectoryEntry["agent"],
  signal: LoadSignal,
): Promise<PromptRecord[]> {
  const cached = promptCache.get(agent.id);
  if (cached?.updatedAt === agent.updatedAt) {
    return cached.prompts;
  }

  const timeline = paseo.agents.ref(agent.id).timeline;
  const prompts: PromptRecord[] = [];
  let cursor: TimelineCursor | undefined;

  for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_AGENT; pageNumber += 1) {
    if (signal.cancelled) {
      return [];
    }

    const page = await timeline.refetch({
      direction: "before",
      limit: PAGE_SIZE,
      projection: "projected",
      ...(cursor === undefined ? {} : { cursor }),
    });

    if (page.error) {
      throw new Error(page.error);
    }

    prompts.push(...promptsFromTimeline(agent, page.entries));

    if (!page.hasOlder || page.startCursor === null || page.startCursor === undefined) {
      break;
    }
    cursor = page.startCursor;
  }

  if (!signal.cancelled) {
    promptCache.set(agent.id, { updatedAt: agent.updatedAt, prompts });
  }

  return prompts;
}

async function loadPromptHistory(
  paseo: Paseo,
  signal: LoadSignal,
  onBatch: PromptBatchHandler,
): Promise<void> {
  const agents: AgentDirectoryEntry[] = [];
  let cursor: string | undefined;

  do {
    if (signal.cancelled) {
      return;
    }

    const directory = await paseo.agents.list({
      filter: { includeArchived: true },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
      signal: signal.abortSignal,
    });
    agents.push(...directory.entries);

    const nextCursor = directory.pageInfo.nextCursor;
    if (!directory.pageInfo.hasMore || !nextCursor || nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
  } while (!signal.cancelled);

  let nextAgent = 0;
  async function loadNextAgent(): Promise<void> {
    while (!signal.cancelled) {
      const entry = agents[nextAgent];
      nextAgent += 1;
      if (!entry) {
        return;
      }

      try {
        const prompts = await loadAgentPrompts(paseo, entry.agent, signal);
        if (!signal.cancelled && prompts.length > 0) {
          onBatch(prompts);
        }
      } catch (error) {
        if (!signal.cancelled) {
          console.warn(`Could not read prompt history for ${entry.agent.id}`, error);
        }
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_AGENT_LOADS, agents.length) },
      () => loadNextAgent(),
    ),
  );
}

function formatPrompt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function PromptHistoryContent({
  theme,
  layout,
  agentId,
  onClose,
}: {
  theme: PluginButtonContentProps["theme"];
  layout: PluginButtonContentProps["layout"];
  agentId: string;
  onClose: () => void;
}) {
  const paseo = usePaseo();
  const toast = useToast();
  const searchRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const editorRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const resultsRef = useRef<NativeFlatList<PromptRecord>>(null);
  const [query, setQuery] = useState("");
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [queuedPrompts, setQueuedPrompts] = useState<string[]>(() => [
    ...getQueuedPrompts(agentId),
  ]);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const matches = useMemo(() => rankPrompts(prompts, query), [prompts, query]);
  const safeSelectedIndex = Math.min(selectedIndex, Math.max(matches.length - 1, 0));
  const selected = matches[safeSelectedIndex];

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
      queued: {
        padding: 10,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.surface2,
        gap: 5,
      },
      queuedTitle: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },
      queuedText: { color: theme.colors.foreground, fontSize: 12, lineHeight: 16 },
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
          setError(loadError instanceof Error ? loadError.message : "Could not load prompt history.");
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
  }, [agentId, paseo]);

  useEffect(() => {
    setQueuedPrompts([...getQueuedPrompts(agentId)]);
    return subscribePromptQueue((queuedAgentId, messages) => {
      if (queuedAgentId === agentId) {
        setQueuedPrompts([...messages]);
      }
    });
  }, [agentId]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  useEffect(() => {
    if (matches.length > 0) {
      resultsRef.current?.scrollToIndex({
        index: safeSelectedIndex,
        viewPosition: 0.5,
        animated: false,
      });
    }
  }, [matches.length, safeSelectedIndex]);

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current) {
      return;
    }

    sendingRef.current = true;
    setSending(true);
    try {
      const result = await sendPrompt(paseo, agentId, trimmed);
      if (result === "queued") {
        toast.show("Prompt queued. It will send when the agent is idle.", { variant: "success" });
      } else {
        toast.show("Prompt sent", { variant: "success" });
        onClose();
      }
    } catch (sendError: unknown) {
      toast.error(sendError instanceof Error ? sendError.message : "Could not send prompt.");
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
      setSelectedIndex((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
    } else if (key === "ArrowUp") {
      event.preventDefault?.();
      setSelectedIndex((index) => Math.max(index - 1, 0));
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
        accessibilityLabel="Search previous prompts"
        placeholder="Search previous prompts…"
        placeholderTextColor={theme.colors.foregroundMuted}
        value={query}
        onChangeText={setQuery}
        onKeyPress={handleSearchKeyPress}
        style={styles.search}
      />
      <Text style={styles.hint}>↑↓ choose · Enter send · Tab edit here · Cmd/Ctrl+Enter send</Text>

      {queuedPrompts.length > 0 ? (
        <View style={styles.queued}>
          <Text style={styles.queuedTitle}>
            Queued for this agent · {queuedPrompts.length}
          </Text>
          {queuedPrompts.slice(0, 3).map((prompt, index) => (
            <Text key={`${index}:${prompt}`} numberOfLines={2} style={styles.queuedText}>
              {formatPrompt(prompt)}
            </Text>
          ))}
          {queuedPrompts.length > 3 ? (
            <Text style={styles.queuedText}>+{queuedPrompts.length - 3} more</Text>
          ) : null}
        </View>
      ) : null}

      {loading ? <Text style={styles.empty}>Loading prompt history…</Text> : null}
      {error ? <Text style={styles.empty}>{error}</Text> : null}
      {!loading && !error && matches.length === 0 ? (
        <Text style={styles.empty}>{query ? "No matching prompts." : "No previous prompts found."}</Text>
      ) : null}
      {!error && matches.length > 0 ? (
        <View accessibilityRole="menu">
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
            renderItem={({ item: prompt, index }) => {
              const active = index === safeSelectedIndex;
              return (
                <Pressable
                  accessibilityLabel={formatPrompt(prompt.text)}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: active }}
                  onPress={() => void send(prompt.text)}
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
            }}
          />
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
