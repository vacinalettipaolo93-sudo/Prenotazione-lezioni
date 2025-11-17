import React, { useState, useEffect, useCallback } from 'react';
import * as GCal from '../../services/googleCalendar';
import { type AppSettings, type GoogleCalendar } from '../../types';
import { type TabProps } from './types';
import Spinner from '../Spinner';
import { updateAppSettings } from '../../services/firebase';
import { getAuth } from 'firebase/auth';

interface ServerConfigurationErrorProps {
    onRetry: () => void;
    isLoading: boolean;
}

// Guide UI for service account configuration
const ServerConfigurationError: React.FC<ServerConfigurationErrorProps> = ({ onRetry, isLoading }) => (
    <div className="bg-amber-900/20 border-2 border-amber-600 text-amber-200 p-8 rounded-xl" role="alert">
        <h2 className="text-2xl font-bold mb-4 text-white">⚙️ Configurazione Richiesta: Collegamento Permanente</h2>
        <p className="mb-4">
            Per attivare l'integrazione con Google Calendar in modo stabile e permanente, è necessario configurare un <strong>"Service Account"</strong>.
            Si tratta di una procedura da eseguire una sola volta che garantirà la sincronizzazione automatica senza più bisogno di connessioni manuali.
        </p>
        <div className="space-y-4">
            <div>
                <h3 className="font-bold text-lg text-white">Passo 1: Crea il Service Account</h3>
                <ol className="list-decimal list-inside ml-4 text-sm space-y-1 mt-2">
                    <li>Vai alla <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">Console IAM</a>.</li>
                    <li>Clicca su <strong>"+ CREA ACCOUNT DI SERVIZIO"</strong>.</li>
                    <li>Dagli un nome (es. "Gestore Calendario Prenotazioni") e clicca "CREA E CONTINUA".</li>
                    <li>Nel passo "Concedi a questo account di servizio l'accesso al progetto", non serve aggiungere ruoli. Clicca "CONTINUA".</li>
                    <li>Nell'ultimo passo, clicca "FINE".</li>
                </ol>
            </div>

            <div>
                <h3 className="font-bold text-lg text-white">Passo 2: Genera e Scarica la Chiave Privata</h3>
                <ol className="list-decimal list-inside ml-4 text-sm space-y-1 mt-2">
                    <li>Trova il service account appena creato nella lista, clicca sui tre puntini a destra e seleziona <strong>"Gestisci chiavi"</strong>.</li>
                    <li>Clicca su "AGGIUNGI CHIAVE" → "Crea nuova chiave".</li>
                    <li>Scegli il formato <strong>JSON</strong> e clicca "CREA". Verrà scaricato un file sul tuo computer.</li>
                </ol>
            </div>

            <div>
                <h3 className="font-bold text-lg text-white">Passo 3: Condividi i Tuoi Calendari</h3>
                <ol className="list-decimal list-inside ml-4 text-sm space-y-1 mt-2">
                    <li>Nel file JSON, trova il valore <code>client_email</code> (es. <code>nome-servizio@...iam.gserviceaccount.com</code>). Copialo.</li>
                    <li>Vai su Google Calendar, seleziona il calendario e scegli "Impostazioni e condivisione".</li>
                    <li>Nella sezione "Condividi con persone o gruppi specifici", incolla l'email del service account e assegna "Apportare modifiche agli eventi".</li>
                </ol>
            </div>

            <div>
                <h3 className="font-bold text-lg text-white">Passo 4: Imposta la Chiave nel Server</h3>
                <p className="text-sm mt-2 mb-2">Esegui questo comando nel terminale (dalla cartella del tuo progetto), incollando l'<strong>intero contenuto</strong> del file JSON scaricato al posto dei puntini:</p>
                <div className="bg-gray-900 text-gray-300 font-mono text-sm p-4 rounded-lg overflow-x-auto">
                    <p>firebase functions:config:set googleapi.service_account_key='...'</p>
                </div>
            </div>
        </div>

        <div className="mt-8 pt-6 border-t border-amber-500/30">
            <button
                onClick={onRetry}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-lg transition disabled:bg-emerald-800 disabled:cursor-not-allowed"
            >
                {isLoading ? <Spinner /> : "Ho completato la configurazione, verifica"}
            </button>
        </div>
    </div>
);


const IntegrationsTab: React.FC<TabProps> = ({ settings: initialSettings, onSettingsChange }) => {
    const [settings, setSettings] = useState<AppSettings>(initialSettings);
    const [connectionStatus, setConnectionStatus] = useState<{ isConnected: boolean; serviceAccountEmail: string | null; error?: string }>({ isConnected: false, serviceAccountEmail: null });
    const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
    const [loadingStatus, setLoadingStatus] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isServerConfigured, setIsServerConfigured] = useState<boolean | null>(null);

    // OAuth UI state
    const [connecting, setConnecting] = useState(false);
    const [oauthMessage, setOauthMessage] = useState<string | null>(null);

    const checkStatus = useCallback(async () => {
        setLoadingStatus(true);
        setConnectionStatus({ isConnected: false, serviceAccountEmail: null });
        try {
            const status = await GCal.getGoogleConnectionStatus();
            setConnectionStatus({
                isConnected: status.isConnected,
                serviceAccountEmail: status.serviceAccountEmail,
                error: status.error,
            });

            if (status.isConnected && status.calendars) {
                setCalendars(status.calendars);
            } else {
                if (status.isConnected) {
                    const calList = await GCal.listCalendars();
                    setCalendars(calList);
                } else {
                    setCalendars([]);
                }
            }
        } catch (error: any) {
            console.error("Failed to check connection status:", error);
            setConnectionStatus({ isConnected: false, serviceAccountEmail: null, error: `Errore di comunicazione: ${error.message}` });
        } finally {
            setLoadingStatus(false);
        }
    }, []);
    
    const checkServer = useCallback(async () => {
        setLoadingStatus(true);
        try {
            const configStatus = await GCal.checkServerConfiguration();
            setIsServerConfigured(configStatus.isConfigured);
            if (configStatus.isConfigured) {
                await checkStatus();
            }
        } catch (error: any) {
            console.error("Failed to check server configuration:", error);
            setIsServerConfigured(false);
            setConnectionStatus({isConnected: false, serviceAccountEmail: null, error: `Impossibile verificare la configurazione: ${error.message}`});
        } finally {
            setLoadingStatus(false);
        }
    }, [checkStatus]);

    useEffect(() => {
        checkServer();
    }, [checkServer]);
    
    useEffect(() => {
        setSettings(initialSettings);
    }, [initialSettings]);

    // Handle redirect after OAuth popup completes
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("google_connected") === "1") {
            setOauthMessage("Google collegato con successo!");
            setTimeout(() => {
                checkServer();
                window.history.replaceState({}, "", window.location.pathname);
            }, 600);
        }
    }, [checkServer]);

    const handleMappingChange = (locationId: string, calendarId: string) => {
        setSettings(prev => {
            if (!prev) return prev;
            const newMapping = { ...prev.locationCalendarMapping, [locationId]: calendarId };
            const selectedIds = new Set(Object.values(newMapping).filter(id => id && id !== 'none'));
            return { ...prev, locationCalendarMapping: newMapping, selectedCalendarIds: Array.from(selectedIds) };
        });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateAppSettings({
                locationCalendarMapping: settings.locationCalendarMapping,
                selectedCalendarIds: settings.selectedCalendarIds
            });
            onSettingsChange();
            alert("Impostazioni salvate!");
        } catch(error: any) {
             setConnectionStatus(prev => ({...prev, error: `Errore durante il salvataggio: ${error.message}`}))
        } finally {
            setSaving(false);
        }
    };

    // New: initiate OAuth flow (calls backend to get auth URL and opens popup)
    const handleConnectWithGoogle = async () => {
        try {
            setConnecting(true);
            setOauthMessage(null);
            const auth = getAuth();
            const user = auth.currentUser;
            if (!user) {
                setOauthMessage("Devi essere loggato come amministratore per connettere Google.");
                setConnecting(false);
                return;
            }
            const idToken = await user.getIdToken();
            const resp = await fetch('/api/getGoogleAuthUrl', {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${idToken}`,
                },
            });
            if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(txt || 'Errore ottenimento URL di autorizzazione');
            }
            const json = await resp.json();
            const url = json?.data?.url;
            if (!url) throw new Error('URL di autorizzazione non disponibile.');
            window.open(url, 'googleAuth', 'width=600,height=700');
            setOauthMessage("Popup aperto. Completa il consenso Google nella nuova finestra.");
        } catch (err: any) {
            console.error('OAuth start error', err);
            setOauthMessage(err.message || 'Errore durante l\'avvio del flusso OAuth.');
        } finally {
            setConnecting(false);
        }
    };

    if (loadingStatus) {
         return <div className="flex items-center justify-center p-10"><Spinner /> Caricamento stato integrazione...</div>;
    }

    if (isServerConfigured === false) {
        return (
            <>
                <ServerConfigurationError onRetry={checkServer} isLoading={loadingStatus} />
                <div className="mt-8">
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                        <h3 className="text-lg font-bold text-white mb-3">Connessione alternativa (Account Google)</h3>
                        <p className="text-gray-400 mb-4">Se non vuoi usare un Service Account, puoi collegare manualmente un Account Google amministratore tramite OAuth (richiede consenso Google).</p>
                        <div className="flex gap-3">
                            <button onClick={handleConnectWithGoogle} disabled={connecting} className="bg-white text-black py-2 px-4 rounded-md border">
                                {connecting ? 'Apro popup...' : 'Connetti con Google (Account)'}
                            </button>
                            <button onClick={checkServer} className="bg-gray-700 text-white py-2 px-4 rounded-md border">Verifica Configurazione Service Account</button>
                        </div>
                        {oauthMessage && <p className="mt-3 text-sm text-emerald-300">{oauthMessage}</p>}
                    </div>
                </div>
            </>
        );
    }
    
    return (
        <div className="space-y-12">
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-2 text-white">Integrazione Google Calendar</h2>
                <p className="text-gray-400 mb-6">Collega i tuoi calendari per sincronizzare automaticamente le prenotazioni.</p>

                {connectionStatus.isConnected ? (
                    <div className="bg-green-900/50 border border-green-700 p-4 rounded-lg">
                        <p className="font-semibold text-green-300">Stato: Connesso</p>
                        <p className="text-white text-sm">L'integrazione è attiva tramite l'account di servizio: <strong className="font-mono">{connectionStatus.serviceAccountEmail}</strong></p>
                    </div>
                ) : (
                    <div className="bg-red-900/50 border border-red-700 p-4 rounded-lg">
                        <p className="font-semibold text-red-300">Stato: Errore di Connessione</p>
                        <p className="text-white text-sm">{connectionStatus.error || "Impossibile connettersi a Google Calendar."}</p>

                        <div className="mt-4 flex items-center gap-3">
                            <button onClick={handleConnectWithGoogle} disabled={connecting} className="bg-white text-black py-2 px-4 rounded-md border">
                                {connecting ? 'Apro popup...' : 'Connetti con Google (Account)'}
                            </button>
                            <button onClick={checkServer} className="bg-gray-700 text-white py-2 px-4 rounded-md border">Verifica Service Account</button>
                        </div>
                        {oauthMessage && <p className="mt-3 text-sm text-emerald-300">{oauthMessage}</p>}
                    </div>
                )}
            </div>

            {connectionStatus.isConnected && (
                <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                    <h2 className="text-2xl font-bold mb-2 text-white">Mappatura Calendari per Sede</h2>
                    <p className="text-gray-400 mb-6">Associa ogni sede a un calendario Google. Le nuove prenotazioni verranno aggiunte al calendario corrispondente.</p>
                    
                    {calendars.length > 0 ? (
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
                        <div className="text-center text-gray-500 bg-gray-900/50 p-6 rounded-lg">
                            <p className="font-semibold">Nessun calendario trovato.</p>
                            <p className="text-sm">Assicurati di aver condiviso almeno un calendario con l'email del service account o che l'account Google collegato abbia calendari.</p>
                            <p className="font-mono text-emerald-400 text-sm mt-2">{connectionStatus.serviceAccountEmail}</p>
                        </div>
                    )}
                </div>
            )}
            
            <div className="flex justify-end mt-8">
                <button onClick={handleSave} disabled={saving || !connectionStatus.isConnected} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg transition flex items-center gap-2 disabled:bg-blue-400">
                    {saving ? <Spinner /> : 'Salva Integrazioni'}
                </button>
            </div>
        </div>
    );
};

export default IntegrationsTab;
