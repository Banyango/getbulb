// The primitives plugins compose. Hover, scrolling and focus styling live here.
import type { CSSProperties, ReactNode } from 'react';

export function Stack(p: { dir?: 'row' | 'column'; gap?: number; pad?: number; grow?: boolean; align?: CSSProperties['alignItems']; style?: CSSProperties; children?: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: p.dir ?? 'column', gap: p.gap, padding: p.pad, flex: p.grow ? 1 : undefined, alignItems: p.align, minWidth: 0, minHeight: 0, ...p.style }}>{p.children}</div>;
}
export function Text(p: { muted?: boolean; bold?: boolean; size?: number; children?: ReactNode }) {
  return <span style={{ color: p.muted ? 'var(--bulb-text-muted)' : undefined, fontWeight: p.bold ? 600 : undefined, fontSize: p.size, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.children}</span>;
}
export function Button(p: { onClick?: () => void; title?: string; children?: ReactNode }) {
  return <button className="bulb-button" title={p.title} onClick={p.onClick}>{p.children}</button>;
}
export type ListItem = { id: string; label: ReactNode; detail?: ReactNode; trailing?: ReactNode; selected?: boolean };
export function List(p: { items: ListItem[]; onSelect?: (id: string) => void }) {
  return (
    <div className="bulb-list" role="listbox">
      {p.items.map((i) => (
        <button key={i.id} role="option" aria-selected={!!i.selected} className={`bulb-list-item${i.selected ? ' selected' : ''}`} onClick={() => p.onSelect?.(i.id)}>
          <Stack grow><Text>{i.label}</Text>{i.detail ? <Text muted size={11}>{i.detail}</Text> : null}</Stack>
          {i.trailing}
        </button>
      ))}
    </div>
  );
}
const ICONS: Record<string, string> = { terminal: '›_', close: '×', plus: '+', bell: '•', split: '▥', file: '▤', folder: '▸', check: '✓' };
export function Icon(p: { name: string }) { return <span aria-hidden style={{ fontFamily: 'var(--bulb-font-mono)' }}>{ICONS[p.name] ?? '?'}</span>; }
export function Badge(p: { children?: ReactNode }) { return <span className="bulb-badge">{p.children}</span>; }
