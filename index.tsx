import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

/**
 * Minimal app entry in TSX that compiles with Vite/esbuild.
 * This is a safe fallback UI that avoids syntax errors during build.
 * Replace with your full app later if needed.
 */

function App(): JSX.Element {
  const style: React.CSSProperties = {
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
    color: '#e6eef8',
    background: '#07112a',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  };
  const box: React.CSSProperties = {
    maxWidth: 980,
    width: '100%',
    background: '#071a36',
    borderRadius: 8,
    padding: 28,
    boxShadow: '0 6px 30px rgba(2,6,23,0.6)',
    textAlign: 'center',
  };

  return (
    <div style={style}>
      <div style={box}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Gestione Prenotazioni — fallback</h1>
        <p style={{ marginTop: 12, color: '#a9c3e6' }}>
          Questa è una versione minima di fallback per evitare errori 404/build.
          Per ripristinare tutte le funzionalità, ricompila la build Vite con i sorgenti originali.
        </p>
        <div style={{ marginTop: 16 }}>
          <a href="/" style={{ color: '#8cd1ff', textDecoration: 'underline' }}>
            Ricarica la pagina
          </a>
        </div>
      </div>
    </div>
  );
}

const rootEl = document.getElementById('root')!;
createRoot(rootEl).render(<App />);
export default App;
