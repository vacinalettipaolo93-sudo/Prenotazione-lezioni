import React, { useState, useEffect, useCallback } from 'react';
import * as GCal from '../../services/googleCalendar';
import { type AppSettings, type GoogleCalendar } from '../../types';
import { type TabProps } from './types';
import Spinner from '../Spinner';
import { updateAppSettings } from '../../services/firebase';

interface ServerConfigurationErrorProps {
    onRetry: () => void;
    isLoading: boolean;
}

const ServerConfigurationError: React.FC<ServerConfigurationErrorProps> = ({ onRetry, isLoading }) => (
    <div className="bg-red-900/20 border-2 border-red-600 text-red-200 p-8 rounded-xl" role="alert">
        <h2 className="text-2xl font-bold mb-4 text-white">⚠️ Configurazione del Server Incompleta</h2>
        <p className="mb-4">
            L'integrazione con Google Calendar non può essere attivata perché il server (Firebase Functions) non è stato configurato correttamente.
            Mancano le chiavi API di Google o l'ID Amministratore necessari per comunicare in modo sicuro.
        </p>
        <h3 className="font-bold text-lg mb-2 text-white">Azione Richiesta (per l'amministratore):</h3>
        <p className="mb-2">
            È necessario impostare le variabili di configurazione nel tuo progetto Firebase. Esegui i seguenti comandi nel terminale dalla root del tuo progetto,
            sostituendo i valori segnaposto con le tue credenziali reali.
        </p>
        <div className="bg-gray-900 text-gray-300 font-mono text-sm p-4 rounded-lg overflow-x-auto">
            <p className="mb-2">firebase functions:config:set googleapi.client_id="IL_TUO_CLIENT_ID_GOOGLE"</p>
            <p className="mb-2">firebase functions:config:set googleapi.client_secret="IL_TUO_CLIENT_SECRET_GOOGLE"</p>
            <p className="mb-2">firebase functions:config:set googleapi.redirect_uri="L'URL_DI_CALLBACK_DALLE_FUNCTIONS"</p>
            <p>firebase functions:config:set admin.uid="IL_TUO_FIREBASE_ADMIN_UID"</p>
        </div>
        <p className="mt-4">
            Dopo aver eseguito questi comandi, devi fare nuovamente il <strong>deploy</strong> delle tue funzioni con il comando: <code className="bg-gray-900 p-1 rounded">firebase deploy --only functions</code>.
        </p>
        <p className="mt-2 text-xs text-red-300">
            L'URL di redirect di solito si trova nella console di Firebase Functions dopo il primo deploy, oppure puoi costruirlo come: https://us-central1-&lt;il-tuo-project-id&gt;.cloudfunctions.net/api/oauthcallback
        </p>
        <div className="mt-8 pt-6 border-t border-red-500/30">
            <button
                onClick={onRetry}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-lg transition disabled:bg-emerald-800 disabled:cursor-wait"
            >
                {isLoading ? <Spinner /> : "Ho completato la configurazione, verifica di nuovo"}
            </button>
        </div>
    </div>
);


const IntegrationsTab: React.FC<TabProps> = ({ settings: initialSettings, onSettingsChange }) => {
    const [settings, setSettings] = useState<AppSettings>(initialSettings);
    const [connectionStatus, setConnectionStatus] = useState<{ isConnected: boolean; email: string | null }>({ isConnected: false, email: null });
    const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
    const [loadingStatus, setLoadingStatus] = useState(true);
    const [loadingCalendars, setLoadingCalendars] = useState(false);
    const [saving, setSaving] = useState(false);
    const [apiError, setApiError] = useState<string | null>(null);
    const [isServerConfigured, setIsServerConfigured] = useState<boolean | null>(null);

    const checkStatus = useCallback(async (options: {isInitialCheck: boolean}) => {
        if (!options.isInitialCheck) {
             setLoadingStatus(true);
        }
        setApiError(null);
        try {
            const status = await GCal.checkGoogleConnection();
            setConnectionStatus(status);
            if (status.isConnected) {
                setLoadingCalendars(true);
                try {
                    const calList = await GCal.listCalendars();
                    setCalendars(calList);
                } catch (error: any) {
                    console.error("Failed to load calendars:", error);
                    if (!options.isInitialCheck) {
                       setApiError(`Impossibile caricare i calendari: ${error.message}`);
                    }
                    setCalendars([]);
                } finally {
                    setLoadingCalendars(false);
                }
            } else {
                setCalendars([]);
            }
        } catch (error: any) {
            console.error("Failed to check connection status:", error);
             // Mostra l'errore solo se non è il check iniziale e silenzioso
            if (!options.isInitialCheck) {
                 setApiError(`Errore di comunicazione con il server: ${error.message}.`);
            }
            setConnectionStatus({ isConnected: false, email: null });
        } finally {
            setLoadingStatus(false);
        }
    }, []);
    
    const checkServer = useCallback(async () => {
        setIsServerConfigured(null);
        setLoadingStatus(true);
        setApiError(null);
        try {
            const configStatus = await GCal.checkServerConfiguration();
            setIsServerConfigured(configStatus.isConfigured);
            if (configStatus.isConfigured) {
                await checkStatus({ isInitialCheck: true });
            } else {
                setLoadingStatus(false);
            }
        } catch (error: any) {
            console.error("Failed to check server configuration:", error);
            setIsServerConfigured(false);
            setApiError(`Impossibile verificare la configurazione del server: ${error.message}.`);
            setLoadingStatus(false);
        }
    }, [checkStatus]);

    useEffect(() => {
        checkServer();
    }, [checkServer]);
    
    useEffect(() => {
        setSettings(initialSettings);
    }, [initialSettings]);

    const handleConnect = async () => {
        setApiError(null);

        // 1. Apri il popup IMMEDIATAMENTE al click.
        const popup = window.open('', 'google-auth', 'width=500,height=600');
        
        // 2. Controlla se il popup è stato bloccato.
        if (!popup) {
            setApiError("Il popup è stato bloccato dal browser. Abilita i popup per questo sito e riprova.");
            return;
        }
        popup.document.write('<html><head><title>Connessione a Google</title><style>body { font-family: sans-serif; background-color: #111827; color: #d1d5db; display: flex; align-items: center; justify-content: center; height: 100%; margin: 0; } .container { text-align: center; } .spinner { border: 4px solid rgba(255, 255, 255, 0.2); width: 36px; height: 36px; border-radius: 50%; border-left-color: #10b981; animation: spin 1s ease infinite; margin: 0 auto 16px; } @keyframes spin { to { transform: rotate(360deg); } } </style></head><body><div class="container"><div class="spinner"></div><p>Attendi, stiamo generando il link di autenticazione...</p></div></body></html>');

        try {
            // 3. Ora recupera l'URL di autenticazione dal backend.
            const authUrl = await GCal.getGoogleAuthUrl();
            
            // 4. Reindirizza il popup all'URL corretto.
            popup.location.href = authUrl;
            
            // 5. Imposta l'intervallo per controllare quando il popup viene chiuso.
            const checkPopup = setInterval(() => {
                if (popup.closed) {
                    clearInterval(checkPopup);
                    // Eseguiamo il check dello stato dopo la chiusura.
                    checkStatus({ isInitialCheck: false });
                }
            }, 1000);

        } catch (error: any) {
            console.error("Google connection failed:", error);
            setApiError(`Impossibile avviare la connessione con Google: ${error.message}`);
            // Se c'è un errore, chiudi il popup.
            popup.close();
        }
    };

    const handleDisconnect = async () => {
        if (window.confirm("Sei sicuro di voler disconnettere il tuo account Google? Le prenotazioni non verranno più sincronizzate.")) {
            setApiError(null);
            try {
                await GCal.disconnectGoogleAccount();
                checkStatus({ isInitialCheck: false }); // Refresh status
            } catch (error: any) {
                setApiError(`Errore durante la disconnessione: ${error.message}`);
            }
        }
    };

    const handleMappingChange = (locationId: string, calendarId: string) => {
        setSettings(prev => {
            if (!prev) return prev;
            const newMapping = { ...prev.locationCalendarMapping, [locationId]: calendarId };
            // Also update the general list of selected calendars for fetching busy slots
            const selectedIds = new Set(Object.values(newMapping).filter(id => id && id !== 'none'));
            return { ...prev, locationCalendarMapping: newMapping, selectedCalendarIds: Array.from(selectedIds) };
        });
    };

    const handleSave = async () => {
        setSaving(true);
        setApiError(null);
        try {
            await updateAppSettings({
                locationCalendarMapping: settings.locationCalendarMapping,
                selectedCalendarIds: settings.selectedCalendarIds
            });
            onSettingsChange();
            alert("Impostazioni salvate!");
        } catch(error: any) {
            setApiError(`Errore durante il salvataggio: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    if (isServerConfigured === false) {
        return <ServerConfigurationError onRetry={checkServer} isLoading={loadingStatus} />;
    }
    
    return (
        <div className="space-y-12">
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-2 text-white">Integrazione Google Calendar</h2>
                <p className="text-gray-400 mb-6">Collega il tuo account Google per sincronizzare automaticamente le prenotazioni con il tuo calendario.</p>

                {!connectionStatus.isConnected && !loadingStatus && isServerConfigured && (
                    <div className="bg-blue-900/50 border border-blue-700 text-blue-200 p-4 rounded-lg mb-6" role="alert">
                        <h3 className="font-bold text-lg mb-2">Come funziona la connessione a Google?</h3>
                        <p>Per poter controllare la tua disponibilità in tempo reale e aggiungere automaticamente le nuove prenotazioni, l'app ha bisogno del permesso di accedere al tuo Google Calendar.</p>
                        <p className="mt-2">Clicca su <strong>"Connetti a Google"</strong> per avviare il processo. Si aprirà una finestra di Google dove potrai accedere e concedere le autorizzazioni necessarie. È un'operazione da fare solo una volta.</p>
                    </div>
                )}

                {loadingStatus ? (
                    <div className="flex items-center justify-center p-4"><Spinner /></div>
                ) : connectionStatus.isConnected ? (
                    <div className="bg-green-900/50 border border-green-700 p-4 rounded-lg flex items-center justify-between">
                        <div>
                            <p className="font-semibold text-green-300">Connesso come:</p>
                            <p className="text-white">{connectionStatus.email}</p>
                        </div>
                        <button onClick={handleDisconnect} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg">Disconnetti</button>
                    </div>
                ) : (
                    isServerConfigured && (
                        <div className="bg-gray-900/50 border border-gray-700 p-4 rounded-lg flex items-center justify-between">
                            <div>
                                <p className="font-semibold text-yellow-300">Stato: Non Connesso</p>
                                <p className="text-gray-300">Collega il tuo account per iniziare.</p>
                            </div>
                            <button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">Connetti a Google</button>
                        </div>
                    )
                )}

                {apiError && (
                    <div className="mt-4 bg-red-900/50 border border-red-700 text-red-300 p-3 rounded-lg text-sm">
                        <strong>Errore:</strong> {apiError}
                    </div>
                )}
            </div>

            {connectionStatus.isConnected && (
                <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                    <h2 className="text-2xl font-bold mb-6 text-white">Mappatura Calendari per Sede</h2>
                    <p className="text-gray-400 mb-6">Associa ogni sede a un calendario Google specifico. Le nuove prenotazioni per una sede verranno aggiunte al calendario corrispondente.</p>
                    
                    {loadingCalendars ? (
                         <div className="flex items-center justify-center p-4"><Spinner /></div>
                    ) : calendars.length > 0 ? (
                        <div className="space-y-4">
                            {(settings.locations || []).map(loc => (
                                <div key={loc.id} className="grid grid-cols-1 md:grid-cols-3 items-center gap-4">
                                    <label htmlFor={`cal-select-${loc.id}`} className="font-semibold text-gray-200">{loc.name}</label>
                                    <select 
                                        id={`cal-select-${loc.id}`}
                                        value={settings.locationCalendarMapping?.[loc.id] || 'none'}
                                        onChange={e => handleMappingChange(loc.id, e.target.value)}
                                        className="md:col-span-2 w-full p-2 bg-gray-700 border border-gray-600 rounded-lg text-white"
                                    >
                                        <option value="none">Nessun calendario selezionato</option>
                                        {calendars.map(cal => (
                                            <option key={cal.id} value={cal.id}>
                                                {cal.summary} {cal.primary ? '(Principale)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-gray-500">Nessun calendario trovato o impossibile caricarli.</p>
                    )}
                </div>
            )}
            
            <div className="flex justify-end mt-8">
                <button onClick={handleSave} disabled={saving || !connectionStatus.isConnected} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg transition flex items-center gap-2 disabled:bg-gray-600 disabled:cursor-not-allowed">
                    {saving ? <Spinner /> : 'Salva Integrazioni'}
                </button>
            </div>
        </div>
    );
};

export default IntegrationsTab;
