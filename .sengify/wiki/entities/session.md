# Session

## Definition

A terminal session running an agent harness or other program, which can be shown in the UI.

## Attributes

- Persistence: survives UI restarts.
- Notifications: a session can raise notifications. Using OSC 9/777 sequences and an explicit CLI command was proposed.

## Relationships

- [[daemon]]: owns the session.
- [[layout-tree]]: tabs and splits display sessions.
- [[notification]]: sessions raise notifications.

## Sources

- design discussion, Claude Code session, 2026-11-06
