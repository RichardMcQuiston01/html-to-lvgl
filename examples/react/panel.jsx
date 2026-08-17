// Sample React app for html2lvgl's React input path.
// Run: node src/cli.mjs examples/react/panel.jsx -o out/
//
// Each function component below becomes a reusable LVGL XML component;
// differing props (label, value, unit, text) become LVGL component props.

const page = {
  width: 320, height: 240, backgroundColor: '#101418', overflow: 'hidden',
  display: 'flex', flexDirection: 'column', margin: 0,
  fontFamily: 'sans-serif', boxSizing: 'border-box',
};

function Header({ title, status }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      height: 30, padding: '0 10px', backgroundColor: '#1c2430',
    }}>
      <span style={{ color: '#e6edf3', fontSize: 13 }}>{title}</span>
      <span style={{ color: '#3fb950', fontSize: 11 }}>{status}</span>
    </div>
  );
}

function StatCard({ label, value, unit }) {
  return (
    <div style={{
      flexGrow: 1, display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center', gap: 3,
      backgroundColor: '#1c2430', borderRadius: 8,
      border: '1px solid #2d3a4d',
    }}>
      <div style={{ color: '#e6edf3', fontSize: 22 }}>{value}</div>
      <div style={{ color: '#7d8590', fontSize: 10 }}>{label} {unit}</div>
    </div>
  );
}

function ActionButton({ text, color }) {
  return (
    <button style={{
      width: 88, height: 28, border: 'none', borderRadius: 6,
      fontSize: 12, color: '#ffffff', backgroundColor: color,
    }}>{text}</button>
  );
}

export default function Panel() {
  return (
    <div style={page}>
      <Header title="Reactor Deck" status="NOMINAL" />
      <div style={{ display: 'flex', gap: 8, padding: 8, height: 78 }}>
        <StatCard label="CORE" value="311" unit="K" />
        <StatCard label="FLOW" value="1.42" unit="kg/s" />
        <StatCard label="LOAD" value="87" unit="%" />
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '0 8px', height: 78 }}>
        <StatCard label="PRESSURE" value="15.5" unit="MPa" />
        <StatCard label="MARGIN" value="4.1" unit="C" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, paddingTop: 10 }}>
        <ActionButton text="Hold" color="#238636" />
        <ActionButton text="Scram" color="#da3633" />
      </div>
    </div>
  );
}
