import React, { createContext, useContext, ReactNode } from 'react';

// ==========================================================================================
// NOTA DELLO SVILUPPATORE:
// Questo Context è stato deprecato e reso inattivo.
// L'architettura precedente basata su un'autenticazione Google lato client era difettosa
// e causava problemi di connessione e inconsistenza dei dati.
// La nuova architettura centralizza tutta la logica di Google Calendar nelle Firebase Functions,
// rendendo questo context globale obsoleto. I componenti ora chiamano direttamente
// il nuovo servizio in `services/googleCalendar.ts` che a sua volta invoca le funzioni backend.
// ==========================================================================================

interface GoogleCalendarContextType {
  isReady: boolean;
  isAuthorized: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const stub = (): never => {
    throw new Error("Stai usando un GoogleCalendarContext deprecato. La logica è stata spostata nelle Cloud Functions e nel servizio API `services/googleCalendar.ts`.");
}

const GoogleCalendarContext = createContext<GoogleCalendarContextType>({
    isReady: false,
    isAuthorized: false,
    error: "Context deprecato",
    connect: stub,
    disconnect: stub,
});

interface GoogleCalendarProviderProps {
    children: ReactNode;
    user: any; // Mantenuto per compatibilità della prop
}

export const GoogleCalendarProvider: React.FC<GoogleCalendarProviderProps> = ({ children }) => {
  const value = {
    isReady: true, // Indica sempre pronto, ma...
    isAuthorized: false, // ...non è mai autorizzato tramite questo flusso.
    error: null,
    connect: async () => { console.warn("Flusso di connessione deprecato chiamato."); },
    disconnect: () => { console.warn("Flusso di disconnessione deprecato chiamato."); },
  };

  // Fornisce un valore fittizio per evitare che l'app vada in crash.
  return (
    <GoogleCalendarContext.Provider value={value}>
      {children}
    </GoogleCalendarContext.Provider>
  );
};

export const useGoogleCalendar = (): GoogleCalendarContextType => {
  const context = useContext(GoogleCalendarContext);
  if (context === undefined) {
    throw new Error("useGoogleCalendar deve essere usato all'interno di un GoogleCalendarProvider");
  }
  // Avvisa lo sviluppatore che sta usando un hook deprecato
  if (context.connect === stub) {
      console.warn("Stai usando l'hook `useGoogleCalendar` deprecato. Passa alle chiamate dirette dal servizio `services/googleCalendar.ts`.");
  }
  return context;
};
