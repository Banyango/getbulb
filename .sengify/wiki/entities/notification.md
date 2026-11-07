# Notification

## Definition

An alert from a [[session]] that tells the user something needs attention. Working notifications are part of the MVP.

## Attributes

- Sources: terminal escape sequences (OSC 9/777) and an explicit CLI command were proposed.
- Click behavior: taking the user to the right pane was proposed.

## Relationships

- [[session]]: raises notifications.
- [[shell]]: displays them.

## Sources

- design discussion, Claude Code session, 2026-11-06
