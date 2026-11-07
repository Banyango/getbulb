# Overview

**Bulb** is a program that provides the building blocks for agentic workflow GUIs. It starts as a single terminal with a guide prompt, and the user's agent grows it into a custom workspace through conversation. It applies the Tome principle of giving people the primitives to make things, instead of a fixed app.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Origin

The idea came from building herdr TUI plugins, including a minimal code editor that fit the user's workflow. That showed agents can build a UI tailored to one person. Not everyone wants a TUI, so Bulb aims for an app-like experience. cmux is a reference point, but its organization isn't what the user wants.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Example flow

1. On first launch, the user sees only a terminal and a [[guide]] prompt.
2. The user asks for a sidebar of [[session]]s, and the system builds it.
3. The user says that clicking a session opens it in the main window, and the system adds that window.
4. The user asks for a button bar with a code editor. The bar is created, and because no editor exists, the harness builds one as a [[plugin]].

The code editor is only an example of something a user might add. It is not a planned core feature.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Decided

- **Name:** Bulb. It replaces the working name `tome-gui`. The user also chose `getbulb`, taken here to be the npm package and GitHub org name.
- **UI:** start with React. This replaces the earlier GPUI/native direction.
- **Platforms:** not Mac-only.
- **Configuration:** not YAML-driven, because YAML was seen as limiting.
- **Plugins:** JS/TS was favored. The user said it "may" be the way to go before choosing React.
- **[[tome]]:** not required, but tightly integrated.
- **MVP:** open a project, let Tome create tabs and splits, render harness [[session]]s in them, and have notifications work.
- **Plugins:** everything is a plugin, including the sidebar, tabs and other built-in UI. There is no fixed app frame.
- **Terminal:** a required [[plugin]] bundled with the app. Recovery mode has its own built-in fallback terminal.
- **Tabs and splits:** the tree stays in the core, while how it's drawn is replaceable. Bulb ships a default plugin for each, and replacing one doesn't affect running sessions.
- **App container:** Electron, chosen over Tauri.
- **[[daemon]]:** a separate process written in TypeScript.
- **Look and feel:** professional, customizable and app-like. JetBrains and cmux are the reference points. Snappiness is a stated concern with web-based UI.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Proposed, not confirmed

These were assistant recommendations that the user did not explicitly accept:

- xterm.js for terminals.
- `node-pty` for the [[daemon]]'s terminals.
- A pure, undoable [[layout-tree]] engine.
- A live inspection API and CLI for agents.
- Plugins as trusted, in-page code with error boundaries.
- A core limited to the [[daemon]], [[layout-tree]] engine, plugin loader, SDK and a recovery mode outside plugin control.
- Plugin UI running in the page, with an optional background process for files, commands and long-running work.
- Plugins stored globally in `~/.bulb/plugins`, with optional per-project plugins.
- A stable SDK of [[primitive]]s, theme tokens, events and commands.
- Agents reading the live API, writing a plugin and checking it on screen, with Bulb hot-loading it and rolling back failures.
- Layout saved per project, agents barred from approving their own permissions, and a first version built for the user.
- After a daemon crash, restoring layouts and working directories but not running processes.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Differentiators

Other agent harnesses already offer chat-built plugins, so that alone won't set Bulb apart. Proposed differentiators are working with any agent, treating terminals and persistent sessions as the foundation, and letting agents recompose the whole app using stable primitives.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Design ideas to adopt

All proposed:

- Live inspection of the running app, so agents can query its services, slots and theme tokens.
- One install path that reports whether a change is live.
- Requiring agents to verify the rendered result, since a successful install doesn't prove what the user sees.
- One operation shared by UI and agent tools, with authority-granting actions kept user-only.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Core principles

- **The GUI is the product of a session.** It grows through conversation, not through a configuration step.
- **Keep the core small.** Proposed test: if the agent can't build the sidebar through the public API, the API isn't good enough.
- **Preserve what made TUI plugins work.** Proposed requirements are contained failures, a small and opinionated set of building blocks, output the agent can inspect, fast reloads and coherent results by default.
- **Plugins describe UI and react to events, but stay out of rendering.** Hover, scrolling and terminal rendering stay out of plugin code. Proposed.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Proposed milestones

1. **MVP:** `window`, `split`, `tabs` and `terminal`, plus stable IDs, focus and persistence. Done when Tome can create tabs and splits using public commands, sessions survive reopening the app, layouts restore per project, and clicking a notification opens the right pane.
2. **First plugin milestone:** `stack`, `text`, `button`, `list`, `icon`, `badge`, events, commands and theme tokens. An agent should be able to build the sidebar and button bar.
3. **Later, as needed:** `input`, `toggle`, `select`, `tree` and `overlay`.

Not in scope for now: plugin distribution, remote SSH sessions, team features, automatic updates and accessibility beyond sensible defaults.

These milestones predate the switch to React, so some items may change.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Rejected or superseded

- **YAML as the main interface:** the user found it limiting.
- **Mac-only Swift/AppKit with libghostty:** ruled out when the user said they don't want Mac-only.
- **Rust and GPUI:** recommended after that, then replaced when the user chose React.
- **A built-in code editor:** the editor is an example of a user addition, not a core feature.
- **A technical spike:** the user decided not to build one for now, so the snappiness of React and xterm.js remains untested.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Known risks

- A web-based UI may not feel as snappy as the user wants. Proposed mitigations are xterm's WebGL renderer, virtualized lists, keeping terminal output out of React state, and lazy-loading plugins.
- An agent can break the UI it is running in.
- In-page plugins can affect the whole app, and agent-installed npm packages add supply-chain risk.
- Generated plugins need a shared vocabulary of events, such as `file.open` and `session.focus`, to work together.
- With the native feel gone, Bulb shares a stack with other web-based agent apps and depends more on its other differentiators.

_(source: design discussion, Claude Code session, 2026-11-06)_

## Open questions

- Which of the proposals above to accept.
- Whether Bulb could be a Tome backend alongside tmux and cmux, so Tome workers open as Bulb tabs and splits. This hasn't been checked against Tome's backend code.
- What the tight [[tome]] integration includes in practice.
- Whether the name is usable: npm `bulb` is taken by a reactive programming library, GitHub `bulb` is a taken user account, and no `bulb` Homebrew formula was found. Domain checks were inconclusive except `bulb.sh`, which is registered.

_(source: design discussion, Claude Code session, 2026-11-06)_
