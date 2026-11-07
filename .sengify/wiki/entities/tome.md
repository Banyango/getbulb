# Tome

## Definition

The user's tool for running repeatable agentic workflows. Bulb doesn't require it, but integrates tightly with it.

## Attributes

- Workflows: Markdown files with YAML frontmatter.
- Runtime: a daemon starts an orchestrator agent per run, and the orchestrator spawns workers in tmux or cmux sessions.
- Bulb's role in the MVP: Tome creates tabs and splits, and harnesses render in them.

## Relationships

- [[layout-tree]]: Tome creates tabs and splits.
- [[session]]: Tome's harnesses render as sessions.
- [[guide]]: proposed integration point.
- [[plugin]]: proposed integration mechanism.

## Sources

- design discussion, Claude Code session, 2026-11-06
- tome skill documentation, read 2026-11-06
