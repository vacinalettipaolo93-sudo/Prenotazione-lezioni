// Minimal ES module fallback served at /index.tsx
// È un modulo ES valido: importa React/ReactDOM da CDN e monta una UI di placeholder.
// Salva questo file come: index.tsx (nella root del progetto)

import React from 'https://esm.sh/react@18.2.0';
import { createRoot } from 'https://esm.sh/react-dom@18.2.0/client';

function App() {
  const style = {
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
    color: '#e6eef8',
    background: '#07112a',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  };
  const box = {
    maxWidth: 980,
    width: '100%',
    background: '#071a36',
    borderRadius: 8,
    padding: 28,
    boxShadow: '0 6px 30px rgba(2,6,23,0.6)',
    textAlign: 'center',
  };

  return (
    React.createElement('div', { style },
      React.createElement('div', { style: box },
        React.createElement('h1', { style: { margin: 0, fontSize: 22 } }, 'Gestione Prenotazioni — versione fallback'),
        React.createElement('p', { style: { marginTop: 12, color: '#a9c3e6' } },
          'Questa è una versione minima di fallback per evitare errori 404. ',
          'Per ripristinare tutte le funzionalità, esegui il build Vite e assicurati che i riferimenti agli asset siano corretti.'
        ),
        React.createElement('div', { style: { marginTop: 16 } },
          React.createElement('a', { href: '/', style: { color: '#8cd1ff', textDecoration: 'underline' } }, 'Ricarica la pagina')
        )
      )
    )
  );
}

(function mount() {
  let rootEl = document.getElementById('root');
  if (!rootEl) {
    rootEl = document.createElement('div');
    rootEl.id = 'root';
    document.body.appendChild(rootEl);
  }
  try {
    createRoot(rootEl).render(React.createElement(App));
  } catch (err) {
    // Fallback: in alcuni ambienti (vecchi browser) createRoot potrebbe non esistere
    rootEl.innerText = 'Errore nel montare l\'app fallback: ' + (err && err.message);
  }
})();
