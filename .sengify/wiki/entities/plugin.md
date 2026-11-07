# Plugin

## Definition

A user- or agent-created addition to Bulb, such as a chart, approval queue or code editor, that needs no change to the core.

## Attributes

- Scope: everything is a plugin, including the sidebar, tabs and other built-in UI. Decided.
- Terminal: a required plugin bundled with the app. Decided.
- Tabs and splits: default drawing plugins ship with Bulb and can be replaced. Decided.
- Language: JS/TS favored.
- Trust: in-page, trusted code with error boundaries was proposed, not confirmed.
- Proposed test set: session sidebar, live chart, code editor, approval queue.

## Relationships

- [[primitive]]: plugins compose primitives.
- [[guide]]: the harness can build a missing plugin on request.
- [[tome]]: Tome support was proposed as a bundled first-party plugin on the public API.

## Sources

- design discussion, Claude Code session, 2026-11-06
