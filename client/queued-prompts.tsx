import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { errorMessage, formatPrompt } from "./format";
import type { QueueStore } from "./queue";

const QUEUE_PREVIEW_COUNT = 3;

export function useAgentQueue(queues: QueueStore, agentId: string) {
  return useSyncExternalStore(queues.subscribe, () => queues.get(agentId));
}

export function useAgentBusy(queues: QueueStore, agentId: string): boolean {
  return useSyncExternalStore(queues.subscribe, () => queues.busy(agentId));
}

export function QueuedPrompts({
  theme,
  queues,
  agentId,
}: {
  theme: PluginButtonContentProps["theme"];
  queues: QueueStore;
  agentId: string;
}) {
  const toast = useToast();
  const queue = useAgentQueue(queues, agentId);
  const busy = useAgentBusy(queues, agentId);

  if (!queue) {
    return null;
  }

  async function run(action: () => Promise<void>, failure: string) {
    try {
      await action();
    } catch (error: unknown) {
      toast.error(errorMessage(error, failure));
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
            onPress={() => void run(() => queues.resume(agentId), "Could not resume the queue.")}
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
                () => queues.remove(agentId, prompt.id),
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
