import React, { useState, useEffect, useCallback } from 'react';
import * as GCal from '../../services/googleCalendar';
import { type AppSettings, type GoogleCalendar } from '../../types';
import { type TabProps } from './types';
import Spinner from '../Spinner';
import { updateAppSettings } from '../../services/firebase';
import { getAuth } from 'firebase/auth';
import { FIREBASE_CONFIG } from '../../constants';

const API_BASE_URL = `https://us-central1-${FIREBASE_CONFIG.projectId}.cloudfunctions.net/api`;

interface ServerConfigurationErrorProps {
    onRetry: () => void;
    isLoading: boolean;
}

const ServerConfigurationError: React.FC<ServerConfigurationErrorProps> = ({ onRetry, isLoading }) => (
    <div className="bg-amber-900/20 border-2 border-amber-600 text-amber-200 p-8 rounded-xl" role="alert">
        <h2 className="text-2xl font-bold mb-4 text-white">⚙️ Configurazione Richiesta: Collegamento Permanente</h2>
        <p className="mb-4">
            Per attivare l'integrazione stabile è consigliato il Service Account, ma puoi usare anche OAuth per collegare un account Google.
        </p>
        <div className="mt-8 pt-6 border-t border-amber-500/30">
            <button onClick={onRetry} disabled={isLoading} className="w-full bg-emerald-600 text-white py-3 rounded">
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

    const [connecting, setConnecting] = useState(false);
    const [oauthMessage, setOauthMessage] = useState<string | null>(null);

    const checkStatus = useCallback(async () => {
        setLoadingStatus(true);
        try {
            const status = await GCal.getGoogleConnectionStatus();
            setConnectionStatus({
                isConnected: status.isConnected,
                serviceAccountEmail: status.serviceAccountEmail,
                error: status.error,
            });
            if (status.isConnected && status.calendars) setCalendars(status.calendars);
            else if (status.isConnected) {
                const list = await GCal.listCalendars();
                setCalendars(list);
            } else {
                setCalendars([]);
            }
        } catch (err: any) {
            console.error("checkStatus error", err);
            setConnectionStatus({ isConnected: false, serviceAccountEmail: null, error: err.message || "Errore" });
        } finally {
            setLoadingStatus(false);
        }
    }, []);

    const checkServer = useCallback(async () => {
        setLoadingStatus(true);
        try {
            const cfg = await GCal.checkServerConfiguration();
            setIsServerConfigured(cfg.isConfigured);
            if (cfg.isConfigured) await checkStatus();
        } catch (err: any) {
            console.error("checkServer error", err);
            setIsServerConfigured(false);
        } finally {
            setLoadingStatus(false);
        }
    }, [checkStatus]);

    useEffect(() => { checkServer(); }, [checkServer]);
    useEffect(() => { setSettings(initialSettings); }, [initialSettings]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("google_connected") === "1") {
            setOauthMessage("Google collegato con successo!");
            setTimeout(() => { checkServer(); window.history.replaceState({}, "", window.location.pathname); }, 600);
        }
    }, [checkServer]);

    const handleConnectWithGoogle = async () => {
        setConnecting(true);
        setOauthMessage(null);
        try {
            const auth = getAuth();
            const user = auth.currentUser;
            if (!user) { setOauthMessage("Devi essere loggato come amministratore."); setConnecting(false); return; }
            const idToken = await user.getIdToken();
            const resp = await fetch(`${API_BASE_URL}/getGoogleAuthUrl`, {
                method: "GET",
                headers: { Authorization: `Bearer ${idToken}` }
            });
            if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(txt || `HTTP ${resp.status}`);
            }
            const json = await resp.json();
            const url = json?.data?.url;
            if (!url) throw new Error("URL non disponibile");
            window.open(url, "googleAuth", "width=600,height=700");
            setOauthMessage("Popup aperto, completa il consenso Google nella nuova finestra.");
        } catch (err: any) {
            console.error("OAuth start error", err);
            setOauthMessage(err.message || "Errore avviando OAuth");
        } finally {
            setConnecting(false);
        }
    };

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
            await updateAppSettings({ locationCalendarMapping: settings.locationCalendarMapping, selectedCalendarIds: settings.selectedCalendarIds });
            onSettingsChange();
            alert("Impostazioni salvate!");
        } catch (err: any) {
            console.error(err);
            setConnectionStatus(prev => ({ ...prev, error: err.message }));
        } finally { setSaving(false); }
    };

    if (loadingStatus) return <div className="flex items-center justify-center p-10"><Spinner /> Caricamento...</div>;
    if (isServerConfigured === false) {
        return (
            <>
                <ServerConfigurationError onRetry={checkServer} isLoading={loadingStatus} />
                <div className="mt-8">
                    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                        <h3 className="text-lg font-bold text-white mb-3">Connessione alternativa (Account Google)</h3>
                        <p className="text-gray-400 mb-4">Puoi collegare manualmente un account Google amministratore tramite OAuth.</p>
                        <div className="flex gap-3">
                            <button onClick={handleConnectWithGoogle} disabled={connecting} className="bg-white text-black py-2 px-4 rounded"> {connecting ? 'Apro popup...' : 'Connetti con Google (Account)'} </button>
                            <button onClick={checkServer} className="bg-gray-700 text-white py-2 px-4 rounded">Verifica Service Account</button>
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
                        <p className="text-white text-sm">Integrazione attiva: <strong className="font-mono">{connectionStatus.serviceAccountEmail}</strong></p>
                    </div>
                ) : (
                    <div className="bg-red-900/50 border border-red-700 p-4 rounded-lg">
                        <p className="font-semibold text-red-300">Stato: Errore di Connessione</p>
                        <p className="text-white text-sm">{connectionStatus.error || "Impossibile connettersi a Google Calendar."}</p>
                        <div className="mt-4 flex items-center gap-3">
                            <button onClick={handleConnectWithGoogle} disabled={connecting} className="bg-white text-black py-2 px-4 rounded"> {connecting ? 'Apro popup...' : 'Connetti con Google (Account)'} </button>
                            <button onClick={checkServer} className="bg-gray-700 text-white py-2 px-4 rounded">Verifica Service Account</button>
                        </div>
                        {oauthMessage && <p className="mt-3 text-sm text-emerald-300">{oauthMessage}</p>}
                    </div>
                )}
            </div>

            {connectionStatus.isConnected && (
                <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                    <h2 className="text-2xl font-bold mb-2 text-white">Mappatura Calendari per Sede</h2>
                    <p className="text-gray-400 mb-6">Associa ogni sede a un calendario Google.</p>
                    {calendars.length > 0 ? (
                        <div className="space-y-4">
                            {(settings.locations || []).map(loc => (
                                <div key={loc.id} className="grid grid-cols-1 md:grid-cols-3 items-center gap-4">
                                    <label htmlFor={`cal-select-${loc.id}`} className="font-semibold text-gray-200">{loc.name}</label>
                                    <select id={`cal-select-${loc.id}`} value={settings.locationCalendarMapping?.[loc.id] || 'none'} onChange={e => handleMappingChange(loc.id, e.target.value)} className="md:col-span-2 w-full p-2 bg-gray-700 border border-gray-600 rounded text-white">
                                        <option value="none">Nessun calendario selezionato</option>
                                        {calendars.map(cal => <option key={cal.id} value={cal.id}>{cal.summary} {cal.primary ? '(Principale)' : ''}</option>)}
                                    </select>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center text-gray-500 bg-gray-900/50 p-6 rounded-lg">
                            <p className="font-semibold">Nessun calendario trovato.</p>
                            <p className="text-sm">Condividi i tuoi calendari con l'account configurato o collega un account tramite OAuth.</p>
                        </div>
                    )}
                </div>
            )}

            <div className="flex justify-end mt-8">
                <button onClick={handleSave} disabled={saving || !connectionStatus.isConnected} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded">
                    {saving ? <Spinner /> : 'Salva Integrazioni'}
                </button>
            </div>
        </div>
    );
};

export default IntegrationsTab;