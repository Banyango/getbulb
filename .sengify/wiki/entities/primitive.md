# Primitive

## Definition

A small, stable UI building block that agents compose into a workspace. The primitive set follows the Tome principle and is treated as the core of the product.

## Attributes

- Proposed structure: window, split, tabs, stack, overlay.
- Proposed content: terminal, text, button, input, toggle, select, list, tree, icon, badge.
- Proposed behavior: stable IDs, events, commands, focus, theme tokens, persistence.
- Implementation: React components, under the React direction.

## Relationships

- [[layout-tree]]: built from primitives.
- [[plugin]]: composes primitives.

## Sources

- design discussion, Claude Code session, 2026-11-06
