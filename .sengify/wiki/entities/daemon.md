# Daemon

## Definition

The background harness process that runs and owns terminal sessions, independently of the UI.

## Attributes

- Lifetime: keeps sessions alive across UI restarts.
- Implementation: a separate TypeScript process. Decided. Using `node-pty` was proposed.
- Crash behavior: restoring layouts and working directories, but not processes, was proposed, not confirmed.

## Relationships

- [[session]]: the daemon owns sessions.
- [[shell]]: the shell connects to the daemon to render sessions.

## Sources

- design discussion, Claude Code session, 2026-11-06
