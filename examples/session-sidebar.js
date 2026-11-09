// A project navigator built only from the public plugin API.
//   bulb plugin install examples/session-sidebar.js
//   bulb split --root --dir row --before --fixed 220 --view sessions --title Projects
export default function (bulb) {
  const { h, ui } = bulb;
  bulb.views.register('sessions', function Projects({ tab }) {
    const layout = bulb.useLayout();
    const notes = bulb.useNotifications();
    const [projects, setProjects] = bulb.React.useState([]);
    const [error, setError] = bulb.React.useState('');
    bulb.React.useEffect(() => {
      let live = true;
      const refresh = () => bulb.command('project.list').then((items) => {
        if (live) setProjects(items);
      }).catch((e) => { if (live) setError(e.message); });
      refresh();
      const timer = setInterval(refresh, 2000);
      return () => { live = false; clearInterval(timer); };
    }, [layout]);
    const run = (name, args) => bulb.command(name, args).catch((e) => setError(e.message));
    const panes = bulb.layout.panes(layout);
    const sidebar = bulb.layout.paneOfTab(layout, tab.id);
    const mainPanes = panes.filter((pane) => pane.id !== sidebar?.id);
    const lastMain = bulb.React.useRef(null);
    const focusedMain = mainPanes.find((pane) => pane.id === layout.focus);
    if (focusedMain) lastMain.current = focusedMain.id;
    const target = mainPanes.find((pane) => pane.id === lastMain.current)
      ?? mainPanes.find((pane) => pane.tabs.some((t) => t.kind === 'terminal'))
      ?? mainPanes[0];
    const newTab = () => target
      ? run('tab.new', { pane: target.id })
      : run('split.new', { target: sidebar.id, dir: 'row' });
    const openProject = () => run('project.choose');
    return h(ui.Stack, { style: { height: '100%', background: 'var(--bulb-surface)', overflow: 'auto' } },
      h(ui.Stack, { pad: 10, dir: 'row', align: 'center', style: { justifyContent: 'space-between' } },
        h(ui.Text, { bold: true }, 'Projects'),
        h(ui.Button, { title: 'Open project', onClick: openProject }, h(ui.Icon, { name: 'folder' }))),
      error ? h('div', { role: 'alert', style: { padding: 10 } }, error) : null,
      ...projects.map((project) => {
        const current = project.project === bulb.project;
        const projectTabs = current ? panes.flatMap((pane) => pane.tabs)
          .filter((t) => !(t.kind === 'view' && t.view === 'sessions')) : project.tabs;
        const active = target?.active;
        const items = projectTabs.map((t) => {
          const unread = current && t.kind === 'terminal'
            ? notes.filter((n) => !n.read && n.session === t.sessionId).length : 0;
          return {
            id: t.id, label: t.title,
            selected: current && active === t.id,
            trailing: unread ? h(ui.Badge, null, unread) : null,
          };
        });
        return h(ui.Stack, { key: project.project },
          h(ui.Stack, { pad: 10, dir: 'row', align: 'center', style: { justifyContent: 'space-between' } },
            h(ui.Button, { title: project.project, onClick: () => {
              if (!current) run('project.open', { project: project.project });
            } }, h(ui.Text, { bold: current }, project.title)),
            current ? h(ui.Button, { title: 'New tab', onClick: newTab }, h(ui.Icon, { name: 'plus' })) : null),
          h('div', { style: { paddingLeft: 12 } },
            h(ui.List, { items, onSelect: (id) => current
              ? run('tab.activate', { tab: id })
              : run('project.open', { project: project.project, tab: id }) })));
      }));
  });
}
