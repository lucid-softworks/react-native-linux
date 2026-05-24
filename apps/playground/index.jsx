// react-native-linux playground app.
//
// This file is the entire user-facing React surface. Everything that
// makes JSX → GTK possible (Hermes shims, react-reconciler host
// config, root-container bootstrap) lives in `./runtime/` so this
// file can stay focused on the React app itself.

const {useState, useEffect} = require('react');
const {render} = require('./runtime');

function Button({x, y, width = 200, height = 60, color = '#3b82f6', label, onClick}) {
  return (
    <box x={x} y={y} width={width} height={height} backgroundColor={color} onClick={onClick}>
      <label
        x={16}
        y={Math.max(0, (height - 24) / 2)}
        width={width - 32}
        height={24}
        text={label}
      />
    </box>
  );
}

function Swatch({x, y, label, value}) {
  return (
    <box x={x} y={y} width={300} height={64} backgroundColor="#1e293b">
      <label x={16} y={8}  width={268} height={20} text={label} />
      <label x={16} y={32} width={268} height={24} text={String(value)} />
    </box>
  );
}

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    rnLinux.log('info', 'React App mounted — useEffect ran ✓');
  }, []);

  useEffect(() => {
    rnLinux.log('info', 'count is now ' + count);
  }, [count]);

  return (
    <box x={0} y={0} width={1024} height={720} backgroundColor="#0f172a">
      <label x={80} y={56} width={860} height={48}
             text="🧹  cleaned up index.jsx  🧹" />
      <label x={80} y={108} width={860} height={22}
             text="click a button, watch the count update through useState" />

      <Swatch x={80}  y={160} label="count"         value={count} />
      <Swatch x={400} y={160} label="count × 2"     value={count * 2} />
      <Swatch x={720} y={160} label="count is even" value={count % 2 === 0 ? 'yes' : 'no'} />

      <Button x={80}  y={260} color="#22c55e" label="+1"
              onClick={() => setCount((c) => c + 1)} />
      <Button x={300} y={260} color="#f97316" label="+10"
              onClick={() => setCount((c) => c + 10)} />
      <Button x={520} y={260} color="#ef4444" label="reset"
              onClick={() => setCount(0)} />

      <label x={80} y={360} width={860} height={22}
             text="GtkGestureClick → JSI fn call → setState → reconciler → setText" />
      <label x={80} y={390} width={860} height={22}
             text="edit apps/playground/index.jsx, run `pnpm watch` — hot reload reboots the runtime." />
    </box>
  );
}

// Disabled while we exercise the Fabric path — the JSI-bridge React
// app's dark-nav outer box covers anything Fabric mounts to the same
// GtkFixed root. Re-enable once the Fabric experiment is captured.
// render(<App />);
rnLinux.log('info', 'JSI-bridge React app disabled; Fabric demo only');
