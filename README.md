# Bulb

Building blocks for agentic workflow GUIs. Bulb opens as a single terminal, and your agent grows it into your workspace.

## Run

```sh
npm install
npm start -- /path/to/project   # Electron
npm run web -- /path/to/project # prints a URL for a browser, if Electron has no display
```

Add `bin/` to your PATH to use `bulb` outside Bulb's terminals. Inside them it's already available.

On Linux, Electron needs its system libraries (`libasound2`, `libnss3`, `libgbm1` and others). Under WSL, it also needs WSLg for a display.

Try the agent path from a Bulb terminal:

```sh
bulb plugin install examples/session-sidebar.js
bulb split --root --dir row --before --fixed 220 --view sessions --title Sessions
bulb notify "Hello" "Click me"
```

Keys: `Ctrl+Shift+D` split right, `E` split down, `T` new tab, `W` close tab, `Z` undo, `Y` redo.
If a plugin breaks the UI, use View > Recovery Mode.

Agents should read [docs/AGENTS.md](docs/AGENTS.md).

## Layout

- `src/shared/layout.ts`: pure layout tree engine with invertible operations
- `src/daemon/main.ts`: owns sessions, layouts and notifications, and serves the shared command surface
- `src/cli.ts`: the `bulb` CLI, a client of those commands
- `src/renderer/`: draws the tree and hosts plugins. `plugins/builtin.tsx` holds the bundled plugins
- `src/electron/`: the app container

## Test

```sh
npm test          # layout engine
npm run test:e2e  # real renderer and daemon, offscreen in Electron, no display needed
npm run typecheck
```

State lives in `~/.bulb`, or `$BULB_HOME`. `bulb daemon stop` ends the daemon and all its sessions.
