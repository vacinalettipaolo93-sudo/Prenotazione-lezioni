import { auth } from './firebase';
import axios from 'axios';
import { type GoogleCalendar } from '../types';
import { FIREBASE_CONFIG } from '../constants';

// =====================================================================================
// ARCHITETTURA RIVISTA (v3): Service Account
// Questo file ora comunica con un backend che utilizza un Service Account per l'autenticazione
// con Google. Questo elimina completamente il flusso OAuth2 lato utente, rendendo
// la connessione permanente e molto più stabile.
// =====================================================================================

// L'URL di base della nostra funzione API.
const API_BASE_URL = `https://us-central1-${FIREBASE_CONFIG.projectId}.cloudfunctions.net/api`;


/**
 * Helper per chiamare gli endpoint protetti dell'API (richiede login admin).
 * Aggiunge automaticamente il token di autenticazione Firebase all'header.
 */
const callAdminApi = async (endpoint: string, dataPayload?: any) => {
    const user = auth?.currentUser;
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
        return response.data;
    } catch (error: any) {
        console.error(`Errore API [${endpoint}]:`, error.response?.data || error.message);
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
// Implementazione delle funzioni del servizio con la nuova logica
// ==================================================================

export const checkServerConfiguration = async (): Promise<{ isConfigured: boolean }> => {
    const result = await callAdminApi('checkServerSetup');
    return result.data;
};

export const getGoogleConnectionStatus = async (): Promise<{ isConnected: boolean; serviceAccountEmail: string | null; error?: string; calendars?: GoogleCalendar[] }> => {
    if (!auth?.currentUser) return { isConnected: false, serviceAccountEmail: null, error: "Utente non loggato." };
    const result = await callAdminApi('getConnectionStatus');
    return result.data;
};

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
