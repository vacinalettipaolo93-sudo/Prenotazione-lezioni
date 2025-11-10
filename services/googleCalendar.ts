import { GOOGLE_API_CONFIG } from '../constants';
import { type CalendarEvent } from '../types';

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

let tokenClient: any = null;
let onGapiLoaded: () => void;
let onGisLoaded: () => void;
let gapiLoaded = new Promise<void>(resolve => { onGapiLoaded = resolve; });
let gisLoaded = new Promise<void>(resolve => { onGisLoaded = resolve; });


const initGapiClient = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    window.gapi.load('client', () => {
      window.gapi.client.init({
        apiKey: GOOGLE_API_CONFIG.API_KEY,
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
      })
      .then(() => resolve())
      .catch((error: any) => reject(error));
    });
  });
};

const initGisClient = (
  updateAuthStatus: (isAuth: boolean) => void,
  handleError: (error: Error) => void
): Promise<void> => {
    return new Promise((resolve) => {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_API_CONFIG.CLIENT_ID,
            scope: GOOGLE_API_CONFIG.SCOPES,
            callback: (tokenResponse: any) => {
              if (tokenResponse && tokenResponse.access_token) {
                // Se abbiamo un token, lo impostiamo e aggiorniamo lo stato.
                window.gapi.client.setToken(tokenResponse);
                updateAuthStatus(true);
              } else if (tokenResponse.error) {
                // Se c'è un errore nella risposta del token (anche da un tentativo silenzioso),
                // non lo trattiamo come un errore fatale, ma l'utente non è autorizzato.
                console.warn('Silent auth failed or token expired:', tokenResponse.error);
                updateAuthStatus(false);
              }
            },
        });
        resolve();
    });
};

const loadScript = (src: string, id: string, onLoad: () => void): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (document.getElementById(id)) {
            onLoad();
            return resolve();
        }
        const script = document.createElement('script');
        script.src = src;
        script.id = id;
        script.async = true;
        script.defer = true;
        script.onload = () => {
            onLoad();
            resolve();
        };
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.body.appendChild(script);
    });
}

// Funzione unificata per il flusso di autenticazione completo
export const initializeGoogleCalendar = async (
    updateAuthStatus: (isAuth: boolean) => void,
    handleError: (error: Error) => void
): Promise<{success: boolean; error?: string}> => {
  try {
    // Carica entrambi gli script in parallelo
    await Promise.all([
        loadScript('https://apis.google.com/js/api.js', 'gapi-script', onGapiLoaded),
        loadScript('https://accounts.google.com/gsi/client', 'gis-script', onGisLoaded)
    ]);

    // Attendi che entrambi siano caricati
    await gapiLoaded;
    await initGapiClient();

    await gisLoaded;
    await initGisClient(updateAuthStatus, handleError);
    
    // Tentativo di ottenere un token silenziosamente per gli utenti di ritorno.
    // Questo potrebbe essere bloccato da alcuni browser se non avviato da un'azione utente,
    // ma è ripristinato su richiesta per migliorare l'esperienza in produzione (es. Vercel).
    tokenClient.requestAccessToken({ prompt: 'none' });

    return { success: true };
  } catch (error: any) {
    console.error("Google Calendar Initialization Failed. Raw error object:", error);
    
    let detailedMessage = "Si è verificato un errore sconosciuto durante l'inizializzazione.";
    const errorDetails = error?.error || error?.result?.error;

    if (errorDetails) {
        if (errorDetails.status === 'PERMISSION_DENIED' && errorDetails.details?.some((d: any) => d.reason === 'API_KEY_SERVICE_BLOCKED')) {
            detailedMessage = `Ok, la tua configurazione API sembra corretta, ma l'accesso è ancora bloccato. Ci sono due cause molto comuni per questo:

**1. Ritardo nell'applicazione delle modifiche (Molto probabile)**
Google può impiegare fino a 5 minuti per applicare le modifiche alle chiavi API. Se hai appena rimosso le restrizioni, attendi qualche minuto e poi ricarica l'applicazione.

**2. API "Discovery" non abilitata (Meno probabile, ma possibile)**
A volte, un servizio di base chiamato "API Discovery Service" deve essere abilitato. Controlliamo:
  a. Vai alla **Libreria API** nella tua Google Cloud Console.
  b. Cerca **"API Discovery Service"**.
  c. Se non è già abilitata, clicca su **"Abilita"**.

Dopo aver atteso e controllato il punto 2, ricarica la pagina.`;
        } else {
            detailedMessage = `Errore API: ${errorDetails.message} (Codice: ${errorDetails.code}). Potrebbe essere dovuto a una chiave API non corretta o al dominio del sito non autorizzato nel tuo progetto Google Cloud.`;
        }
    } else if (error instanceof Error) {
        detailedMessage = error.message;
    }
    
    console.error(`Error initializing Google Calendar: ${detailedMessage}`);
    return { success: false, error: detailedMessage };
  }
};


export const handleAuthClick = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        if (!tokenClient) {
            return reject(new Error('Google Identity Services client not initialized.'));
        }
        
        // La callback gestirà l'impostazione del token e lo stato
        // sovrascriviamo la callback solo per gestire l'errore specifico di questo click
         const specificCallback = (resp: any) => {
            if (resp.error !== undefined) {
                 if (resp.error === 'invalid_request' || resp.error === 'redirect_uri_mismatch') {
                    const origin = window.location.origin;
                    const detailedError = new Error(`Questo errore indica un problema di configurazione con il tuo "ID client OAuth 2.0" nella Google Cloud Console.

**Come risolvere:**
1. Vai alla tua [Google Cloud Console -> Credenziali](https://console.cloud.google.com/apis/credentials).
2. Trova e modifica il tuo **ID client OAuth 2.0** (di tipo "Applicazione web").
3. In **"Origini JavaScript autorizzate"**, clicca **"+ AGGIUNGI URI"** e incolla questo valore:
\`\`\`
${origin}
\`\`\`
4. In **"URI di reindirizzamento autorizzati"**, fai la stessa cosa: clicca **"+ AGGIUNGI URI"** e incolla:
\`\`\`
${origin}
\`\`\`
5. Salva le modifiche. Potrebbero essere necessari alcuni minuti per l'aggiornamento.`);
                    return reject(detailedError);
                } else if (resp.error === 'popup_closed_by_user') {
                    console.log('User closed the auth popup.');
                    return reject(new Error('Popup di autorizzazione chiuso dall\'utente.'));
                }
                return reject(new Error(`Authorization failed: ${resp.error_description || resp.error}`));
            }
            // Se ha successo, la callback globale ha già aggiornato lo stato
            resolve();
        };

        if (window.gapi.client.getToken() === null) {
            // Sovrascriviamo temporaneamente la callback per una gestione degli errori più specifica
            tokenClient.callback = specificCallback;
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            tokenClient.requestAccessToken({ prompt: '' });
        }
    });
};

export const handleSignoutClick = (): void => {
    const token = window.gapi.client.getToken();
    if (token !== null) {
        window.google.accounts.oauth2.revoke(token.access_token, () => {
            console.log('Access token revoked.');
        });
        window.gapi.client.setToken(null);
    }
};


export const listCalendars = async (): Promise<any[]> => {
  try {
    const response = await window.gapi.client.calendar.calendarList.list({});
    return response.result.items;
  } catch (err) {
    console.error("Error fetching calendar list: ", err);
    return [];
  }
};

export const getBusySlots = async (timeMin: string, timeMax: string, calendarIds: string[]): Promise<{start: string, end: string}[]> => {
  if (!calendarIds || calendarIds.length === 0) {
    return [];
  }
  try {
    const response = await window.gapi.client.calendar.freebusy.query({
      timeMin,
      timeMax,
      items: calendarIds.map(id => ({ id })),
    });
    
    let busyIntervals: {start: string, end: string}[] = [];
    if (response.result.calendars) {
      for (const id in response.result.calendars) {
        if (response.result.calendars[id].busy) {
            busyIntervals = busyIntervals.concat(response.result.calendars[id].busy);
        }
      }
    }
    return busyIntervals;
  } catch (err) {
    console.error("Error fetching free/busy information: ", err);
    return [];
  }
};


export const createCalendarEvent = async (event: CalendarEvent, calendarId: string = 'primary'): Promise<any> => {
    try {
        const response = await window.gapi.client.calendar.events.insert({
            'calendarId': calendarId,
            'resource': event
        });
        return response.result;
    } catch (err) {
        console.error("Error creating calendar event: ", err);
        throw err;
    }
};

export const deleteCalendarEvent = async (calendarId: string, eventId: string): Promise<any> => {
    try {
        return await window.gapi.client.calendar.events.delete({
            'calendarId': calendarId,
            'eventId': eventId,
        });
    } catch (err) {
        console.error("Error deleting calendar event: ", err);
        throw err;
    }
};

export const isAuthorized = (): boolean => {
    return !!window.gapi?.client?.getToken();
}