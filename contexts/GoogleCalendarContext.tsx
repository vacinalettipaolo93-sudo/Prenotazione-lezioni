import React, { createContext, useState, useContext, useEffect, useCallback, ReactNode } from 'react';
import * as GCal from '../services/googleCalendar';
import { type AppUser } from '../types';

interface GoogleCalendarContextType {
  isReady: boolean;
  isAuthorized: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const GoogleCalendarContext = createContext<GoogleCalendarContextType | undefined>(undefined);

interface GoogleCalendarProviderProps {
    children: ReactNode;
    user: AppUser | null;
}

export const GoogleCalendarProvider: React.FC<GoogleCalendarProviderProps> = ({ children, user }) => {
  const [isReady, setIsReady] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateAuthStatus = useCallback((isAuth: boolean) => {
      setIsAuthorized(isAuth);
  }, []);

  const handleAuthError = useCallback((e: Error) => {
      setError(e.message || "Un errore imprevisto è occorso.");
  }, []);

  useEffect(() => {
    const initialize = async () => {
      setError(null);
      setIsReady(false);
      try {
        // Unifichiamo l'inizializzazione: sia l'admin che il cliente usano il flusso OAuth completo
        // per permettere il login automatico e l'accesso al calendario.
        const result = await GCal.initializeGoogleCalendar(updateAuthStatus, handleAuthError);
        
        if (!result.success) {
          setError(result.error || "Errore sconosciuto durante l'inizializzazione.");
          setIsAuthorized(false);
        }
      } catch (e: any) {
        setError(e.message || "Un errore imprevisto è occorso.");
        setIsAuthorized(false);
      } finally {
        setIsReady(true);
      }
    };

    initialize();
  }, [updateAuthStatus, handleAuthError]);

  const connect = async () => {
    setError(null);
    try {
      await GCal.handleAuthClick();
      // Auth status is updated by the global callback
    } catch (e: any) {
      if(e.message !== "Popup di autorizzazione chiuso dall'utente.") {
        setError(e.message || "Si è verificato un errore sconosciuto during l'autorizzazione.");
      }
      setIsAuthorized(false);
    }
  };

  const disconnect = () => {
    GCal.handleSignoutClick();
    setIsAuthorized(false);
    setError(null);
  };

  const value = {
    isReady,
    isAuthorized,
    error,
    connect,
    disconnect,
  };

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
  return context;
};