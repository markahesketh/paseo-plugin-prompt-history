# Prompt history for Paseo

Search and reuse prompts you have already sent in Paseo.

Prompt history adds a native-looking `History` control to each active agent composer. Press `Ctrl+R`, find an earlier prompt with fuzzy search, and either send it immediately or edit it before sending. The interface uses Paseo theme tokens, so it follows both light and dark mode.

## Features

- Fuzzy search across user prompts in accessible Paseo agent timelines.
- `Ctrl+R` opens the history popover and focuses the search field on the Paseo web client.
- Keyboard-first navigation with clear selection state.
- Immediate sending with `Enter`.
- Edit-before-send with `Tab`, then `Cmd+Enter` or `Ctrl+Enter`.
- Tap-to-edit on phones and narrow windows, so a tap never sends a prompt by accident.
- A Command Center entry for opening history when the composer pill is not visible.
- A queue on the daemon for prompts sent while an agent is busy. It keeps working when you close the app.
- Queue previews in the popover, a live count on the `History` composer pill, and a control to remove each queued prompt.
- Native Paseo colours and spacing in light and dark themes.
- No external service, account, or telemetry.

## How to use it

1. Open an agent in Paseo.
2. Press `Ctrl+R`.
3. Type part of the prompt you want to reuse.
4. Use `Arrow Up` and `Arrow Down` to select a result.
5. Choose an action:

   - Press `Enter` to send the prompt.
   - Press `Tab` to place it in the plugin editor.
   - Change the text, then press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux.

On a phone or in a narrow window, tap a prompt to open it in the editor, then tap `Send`.

If the agent is running, the prompt goes into the queue. The popover stays open and shows the queued prompts. The composer pill changes to `History · N queued`. When a turn completes, the plugin sends the next queued prompt. It sends one prompt for each turn, in order.

If a turn is stopped or fails, the queue pauses and sends nothing. The popover shows the reason. Select `Send next` to continue, or remove the prompts you do not want.

You can also open the feature from the Command Center with `Cmd+K` on macOS or `Ctrl+K` on Windows and Linux, then search for `Search prompt history`.

## Install

### From GitHub

Start the Paseo daemon, then install the plugin:

```sh
paseo plugin install https://github.com/markahesketh/paseo-plugin-prompt-history
```

Paseo trusts the plugin source and loads it immediately. Check the installation with:

```sh
paseo plugin ls prompt-history
```

To reload the plugin after a local change:

```sh
paseo plugin reload prompt-history
```

To remove it:

```sh
paseo plugin remove prompt-history
```

### From a local checkout

```sh
git clone https://github.com/markahesketh/paseo-plugin-prompt-history
cd paseo-plugin-prompt-history
paseo plugin install "$PWD"
```

## Requirements

- Paseo `>=0.9.1 <0.13.0`, on both the daemon and each app that connects to it.
- The Paseo web or desktop client for the `Ctrl+R` shortcut.

The plugin also runs in the iOS and Android apps. There, it has no `Ctrl+R` shortcut and a tap opens the editor. Paseo controls which timeline entries are available to the plugin.

`Ctrl+R` opens history only when exactly one `History` pill is visible. If it cannot open history, the key keeps its usual function.

## Development

Install the development dependencies, then run the checks:

```sh
npm install
npm run typecheck
npm test
```

The tests are in `test/`. They cover prompt extraction, history loading, fuzzy ranking, result selection, the `Ctrl+R` match and target choice, the client queue store, the daemon status mapping, and the daemon queue. The history loader and daemon queue tests use a fake Paseo API. Component key handling has no tests. Development needs Node.js 22.6 or later.

## Design notes

The plugin uses only the Paseo plugin APIs:

- Agent subscriptions provide the active agent list.
- Timeline pagination provides historical user messages.
- Composer pills provide the entry point for each active agent.
- Daemon lifecycle hooks (`agent.turn_started`, `agent.turn_ended`, `agent.archived`) drive the queue.
- Plugin RPCs connect the client to the daemon queue.
- A plugin-owned editor handles the `Tab` workflow because Paseo does not expose an API for changing the native composer draft.

History is loaded when the panel or popover opens. It reads up to 20 pages of 100 timeline entries per agent, caches results until an agent changes, removes duplicate prompt text, and ranks matches by fuzzy relevance and recency.

The send queue is on the daemon. Thus all apps connected to the daemon share it, and it continues when no app is connected. It is kept in memory, so a daemon restart or a plugin reload deletes it. A queued prompt is removed from the queue after the daemon accepts it.

The queue sends the next prompt when Paseo reports that a turn ended. It does not wait for the agent status to change to idle, because the Paseo SDK says that change is not a reliable turn-end signal. Paseo delivers hook events on a best-effort basis and not always in order, so the plugin also checks queues every 5 seconds. If it sees an idle agent with queued prompts, it sends the next one. After the plugin sends a prompt, this check waits 60 seconds before it trusts an idle status. The queue ignores a turn-end report for an earlier turn, so a late report cannot send a second prompt into a turn that has already started.

A send can fail on the plugin side, for example on a timeout, after the daemon has accepted the prompt. The queue keeps the prompt and pauses. Each turn-end report lists the messages the daemon ran, by the queued prompt's ID. If the prompt is in that list, the queue drops it and continues. If not, `Send next` sends the prompt again with the same ID. The daemon does not reject a repeated ID, so a prompt that the daemon ran but did not report can run twice.

When the daemon reports an agent as archived or missing, the queue drops that agent's prompts.

The daemon cannot push queue changes to the app. The app reads the queue again after each agent update, and every 10 seconds.

## Project structure

```text
index.client.tsx              Paseo client contribution and composer controls
index.server.ts               Daemon hooks, queue RPCs, and the fallback check
client/prompt-history.tsx     Search, results, and editor
client/queued-prompts.tsx     Queue preview and controls
client/load.ts                Paginated history loading and caching
client/history.ts             Timeline parsing helpers
client/fuzzy.ts               Prompt normalisation, deduplication, and ranking
client/selection.ts           Result selection that follows the prompt
client/queue.ts               Client store for the daemon queue
client/labels.ts              Pill and search labels the Ctrl+R lookup matches
client/format.ts              Text formatting helpers
client/element.ts             Ctrl+R target choice
client/web.ts                 Web-only Ctrl+R integration
server/queue.ts               Daemon queue logic
server/daemon-status.ts       Maps an agent's daemon state to the queue's view
shared/queue.ts               Queue RPC contracts
test/                         Node test runner tests
```

## License

No license has been selected yet. Until a license is added, all rights are reserved.
