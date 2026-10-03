import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useLive } from './live.js';
import Station from './screens/Station.jsx';
import Bedside from './screens/Bedside.jsx';
import BedDetail from './screens/BedDetail.jsx';
import Alerts from './screens/Alerts.jsx';
import Devices from './screens/Devices.jsx';
import './styles.css';

// Hash routes: #/ station, #/monitor/B01 bedside, #/bed/B01 detail, #/alerts, #/devices
function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/');
}

function App() {
  const [page, id] = useRoute();
  const { connected, alerts } = useLive();
  const crit = Object.values(alerts).filter((a) => a.severity === 'crit' && !a.acked_at).length;

  // Bedside monitor is full-screen with no nav.
  if (page === 'monitor' && id) return <Bedside bedId={id} />;

  return (
    <>
      <nav>
        <strong>Smart Bed · Ward A</strong>
        <a href="#/">Station</a>
        <a href="#/alerts">Alerts {crit > 0 && <span className="badge">{crit}</span>}</a>
        <a href="#/devices">Devices</a>
        <span className={`conn ${connected ? 'ok' : 'down'}`}>{connected ? 'live' : 'disconnected'}</span>
      </nav>
      <main>
        {page === 'bed' && id ? <BedDetail bedId={id} />
          : page === 'alerts' ? <Alerts />
          : page === 'devices' ? <Devices />
          : <Station />}
      </main>
      <footer>Prototype — not a medical device. NEWS2* is partial (no RR / ACVPU / O₂).</footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
