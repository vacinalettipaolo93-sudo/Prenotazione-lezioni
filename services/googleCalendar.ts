import { auth, functions } from './firebase';
import axios from 'axios';
import { type GoogleCalendar, type Booking, type CalendarEvent } from '../types';
import { FIREBASE_CONFIG } from '../constants';

// =====================================================================================
// NUOVA ARCHITETTURA:
// Questo file ora chiama un'unica Cloud Function (`api`) che funge da server Express.
// Le diverse operazioni sono gestite come "endpoint" su quel server.
// Questo risolve i problemi di CORS e rende l'architettura più robusta.
// =====================================================================================

// L'URL di base della nostra nuova funzione API.
// Lo costruiamo dinamicamente usando il Project ID per evitare errori.
const API_BASE_URL = `https://us-central1-${FIREBASE_CONFIG.projectId}.cloudfunctions.net/api`;


/**
 * Helper per chiamare gli endpoint protetti dell'API (richiede login admin).
 * Aggiunge automaticamente il token di autenticazione Firebase all'header.
 */
const callAdminApi = async (endpoint: string, dataPayload?: any) => {
    const user = auth?.currentUser;
    // Se l'utente non è loggato, non tentare nemmeno la chiamata.
    if (!user) {
        throw new Error("Autenticazione richiesta per questa operazione.");
    }
    const token = await user.getIdToken();

    try {
        const response = await axios.post(`${API_BASE_URL}/${endpoint}`, {
            data: dataPayload
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        // La nostra API restituisce sempre un oggetto { data: ... } per coerenza
        // con il vecchio SDK httpsCallable.
        return response.data;
    } catch (error: any) {
        console.error(`Errore API [${endpoint}]:`, error.response?.data || error.message);
        // Rilancia l'errore per permettere al chiamante di gestirlo.
        throw new Error(error.response?.data?.error?.message || `Chiamata API a ${endpoint} fallita.`);
    }
};

/**
 * Helper per chiamare gli endpoint pubblici dell'API (non richiede login).
 */
const callPublicApi = async (endpoint: string, dataPayload?: any) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/${endpoint}`, {
             data: dataPayload
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error: any) {
        console.error(`Errore API Pubblica [${endpoint}]:`, error.response?.data || error.message);
        throw new Error(error.response?.data?.error?.message || `Chiamata API a ${endpoint} fallita.`);
    }
};


// ==================================================================
// Implementazione delle funzioni del servizio utilizzando i nuovi helper
// ==================================================================

export const checkServerConfiguration = async (): Promise<{ isConfigured: boolean }> => {
    const result = await callAdminApi('checkServerSetup');
    return result.data;
};

export const checkGoogleConnection = async (): Promise<{ isConnected: boolean; email: string | null; error?: string }> => {
    if (!auth?.currentUser) return { isConnected: false, email: null, error: "Utente non loggato." };
    const result = await callAdminApi('checkTokenStatus');
    return result.data;
};

/**
 * Recupera l'URL di autorizzazione OAuth2 di Google dal backend.
 * Questo URL verrà utilizzato per avviare il flusso di accesso di Google in un popup.
 * @returns {Promise<string>} L'URL di autorizzazione.
 */
export const getGoogleAuthUrl = async (): Promise<string> => {
    const result = await callAdminApi('getAuthURL');
    if (!result.data?.url) {
        throw new Error("URL di autenticazione non ricevuto dal server.");
    }
    return result.data.url;
};

export const disconnectGoogleAccount = async (): Promise<{ success: boolean }> => {
     const result = await callAdminApi('disconnectGoogleAccount');
     return result.data;
}

export const listCalendars = async (): Promise<GoogleCalendar[]> => {
    const result = await callAdminApi('listGoogleCalendars');
    return result.data;
}

export const getBusySlots = async (timeMin: string, timeMax: string, calendarIds: string[]): Promise<{start: string, end: string}[]> => {
  if (!calendarIds || calendarIds.length === 0) {
    return [];
  }
  try {
    const result = await callPublicApi('getBusySlotsOnBehalfOfAdmin', { timeMin, timeMax, calendarIds });
    return result.data;
  } catch (error) {
    console.error("Errore nel recuperare gli slot occupati:", error);
    return [];
  }
};


export const createCalendarEvent = async (eventData: any): Promise<{ eventCreated: boolean, eventId: string | null }> => {
    const result = await callPublicApi('createEventOnBehalfOfAdmin', eventData);
    return result.data;
}
