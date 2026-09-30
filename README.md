# Prompt history for Paseo

Search and reuse prompts you have already sent in Paseo.

Prompt history adds a native-looking `History` control to each active agent composer. Press `Ctrl+R`, find an earlier prompt with fuzzy search, and either send it immediately or edit it before sending. The interface uses Paseo theme tokens, so it follows both light and dark mode.

## Features

- Fuzzy search across user prompts in accessible Paseo agent timelines.
- `Ctrl+R` opens the history popover and focuses the search field on the Paseo web client.
- Keyboard-first navigation with clear selection state.
- Immediate sending with `Enter`.
- Edit-before-send with `Tab`, then `Cmd+Enter` or `Ctrl+Enter`.
- A Command Center entry for opening history when the composer pill is not visible.
- A visible queue indicator when the selected agent is busy.
- Queue previews in the popover and a live count on the `History` composer pill.
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

If the agent is running, the prompt is placed in the plugin queue. The popover remains open and shows the queued prompts. The composer pill changes to `History · N queued`. Paseo sends queued prompts as the agent becomes idle.

You can also open the feature from the Command Center with `Cmd+K` on macOS or `Ctrl+K` on Windows and Linux, then search for `Search prompt history`.

## Install

### From GitHub

Start the Paseo daemon, then install the plugin:

```sh
paseo plugin install https://github.com/markahesketh/paseo-plugin-prompt-history
```

Paseo trusts the plugin source and loads it immediately. Check the installation with:

```sh
paseo plugin status prompt-history --json
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

- Paseo `>=0.9.1 <0.10.0`.
- The Paseo desktop web client for the `Ctrl+R` shortcut.

The plugin is not installed on iOS or Android. Paseo controls which timeline entries are available to the plugin.

## Development

Install the development dependencies, then run the checks:

```sh
npm install
npm run typecheck
npm test
```

The test suite covers prompt extraction, fuzzy ranking, keyboard behaviour, queue behaviour, and the web shortcut seam.

## Design notes

The plugin uses only the Paseo plugin APIs:

- Agent subscriptions provide the active agent list and activity updates.
- Timeline pagination provides historical user messages.
- Composer pills provide the entry point for each active agent.
- A plugin-owned editor handles the `Tab` workflow because Paseo 0.9.1 does not expose an API for changing the native composer draft.

History is loaded when the panel or popover opens. It reads up to 20 pages of 100 timeline entries per agent, caches results until an agent changes, removes duplicate prompt text, and ranks matches by fuzzy relevance and recency.

The send queue is intentionally local to the running plugin. It is not persisted across Paseo restarts. A queued prompt is removed from the indicator after Paseo accepts it for sending.

## Project structure

```text
index.client.tsx       Paseo client contribution and composer controls
client/prompt-history.tsx  Search, results, editor, and queue UI
client/history.ts       Timeline parsing and pagination helpers
client/fuzzy.ts         Prompt normalisation, deduplication, and ranking
client/send.ts          Agent-aware sending and the local queue
client/web.ts           Web-only Ctrl+R integration
```

## License

No license has been selected yet. Until a license is added, all rights are reserved.
