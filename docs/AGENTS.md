# Building on Bulb (for agents)

You are in a terminal inside Bulb. Change the workspace with the `bulb` CLI, which is already on your PATH. Run `bulb --help` for every command.

## Look first

`bulb inspect` prints the live layout (stable IDs), sessions, loaded plugins, registered views and slots, theme tokens, and plugin errors.

## Change the layout

```sh
bulb tab new --cmd "npm test" --title tests
bulb split --dir row                      # beside the focused pane; --dir column for below
bulb split --root --dir row --before --fixed 220 --view sessions --title Sessions   # a sidebar
bulb undo
```

A sidebar is a fixed-width split holding a view tab. Changes persist per project.

## Write a plugin

A plugin is one plain JavaScript file with no build step:

```js
export default function (bulb) {
  const { h, ui } = bulb;
  bulb.views.register('hello', (props) => h(ui.Text, null, 'Hello ', props.name));
  return () => { /* optional cleanup for hot reload */ };
}
```

Install it with `bulb plugin install hello.js`, then show it with `bulb tab new --view hello --props '{"name":"you"}'`. Install exits non-zero and prints the error unless the plugin went live. If a new version fails to load, the previous version keeps running.

### API

| Name | Purpose |
|---|---|
| `bulb.h`, `bulb.React` | `createElement` and `useState`, `useEffect`, `useRef`, `useMemo` |
| `bulb.ui` | `Stack`, `Text`, `Button`, `List`, `Icon`, `Badge`. Prefer these so results look coherent |
| `bulb.views.register(name, Component)` | Content for a tab. Receives `tab`, `focused` and the tab's `--props` |
| `bulb.slots.register(slot, Component)` | Replace `tabBar` (`{pane}`), `split` (`{node, children}`) or `overlay` |
| `bulb.useLayout()`, `useSessions()`, `useNotifications()` | Live state hooks |
| `bulb.layout` | Helpers such as `panes(layout)`, `tabs(layout)`, `paneOfTab(layout, id)` |
| `bulb.command(name, args)` | The commands the CLI uses, such as `tab.new`, `split.new`, `tab.activate` |
| `bulb.on('layout' \| 'sessions' \| 'notifications', fn)` | Events. Returns an unsubscribe function |
| `bulb.theme.set({accent: '#f80'})`, `bulb.theme.tokens()` | Theme tokens, used in styles as `var(--bulb-accent)` |

Use `var(--bulb-*)` for colors rather than hard-coded values.

## Verify what you built

A successful install doesn't prove what the user sees. Run `bulb screenshot /tmp/check.png` and look at it, and check `renderErrors` in `bulb inspect`. A crashed replacement slot falls back to the bundled one, so it can look fine while still being broken.

## Notify the user

`bulb notify "Tests finished" "2 failed"`, or print OSC 9 or OSC 777 from any program. Clicking the notification opens the pane that raised it.

## Safety

Plugins are trusted code that run inside the app. If the UI breaks, the user can open View > Recovery Mode, which loads no plugins. Plugins are global, in `~/.bulb/plugins`.
