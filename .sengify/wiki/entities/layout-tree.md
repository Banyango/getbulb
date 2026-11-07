# Layout tree

## Definition

The live structure describing how windows, splits and tabs are arranged, which agents can read and change.

## Attributes

- Ownership: the tree of tabs and splits is core. Tab bars and split dividers are drawn by replaceable plugins. Decided.
- Stable IDs: proposed, so that UI changes never kill a running terminal.
- Undo: proposed through operations that each return their inverse.
- Sidebars: proposed as collapsible, fixed-width splits, not a separate concept.

## Relationships

- [[primitive]]: the tree is composed of primitives.
- [[session]]: displayed within tabs and splits.
- [[tome]]: creates tabs and splits in the MVP.

## Sources

- design discussion, Claude Code session, 2026-11-06
