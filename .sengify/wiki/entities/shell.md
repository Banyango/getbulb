# Shell

## Definition

The desktop app that renders the [[layout-tree]] and hosts [[plugin]]s. It starts with just a terminal.

## Attributes

- UI technology: React.
- Container: Electron. Decided.
- Terminal rendering: xterm.js was proposed, not confirmed.
- Fallback: recovery mode has a built-in terminal that doesn't depend on the terminal plugin. Decided.
- Recovery: an always-available way back to a raw terminal was proposed, so a bad agent edit can't lock the user out.

## Relationships

- [[daemon]]: supplies sessions.
- [[primitive]]: the shell provides the primitives.

## Sources

- design discussion, Claude Code session, 2026-11-06
