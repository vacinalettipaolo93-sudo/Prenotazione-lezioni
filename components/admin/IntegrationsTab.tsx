import React, { useState, useEffect, useCallback } from 'react';
import * as GCal from '../../services/googleCalendar';
import { type AppSettings, type GoogleCalendar } from '../../types';
import { type TabProps } from './types';
import Spinner from '../Spinner';
import { updateAppSettings } from '../../services/firebase';

const IntegrationsTab: React.FC<TabProps> = ({ settings: initialSettings, onSettingsChange }) => {
    const [settings, setSettings] = useState<AppSettings>(initialSettings);
    const [connectionStatus, setConnectionStatus] = useState<{ isConnected: boolean; email: string | null }>({ isConnected: false, email: null });
    const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
    const [loadingStatus, setLoadingStatus] = useState(true);
    const [loadingCalendars, setLoadingCalendars] = useState(false);
    const [saving, setSaving] = useState(false);

    const checkStatus = useCallback(async () => {
        setLoadingStatus(true);
        try {
            const status = await GCal.checkGoogleConnection();
            setConnectionStatus(status);
            if (status.isConnected) {
                setLoadingCalendars(true);
                try {
                    const calList = await GCal.listCalendars();
                    setCalendars(calList);
                } catch (error) {
                    console.error("Failed to load calendars:", error);
                    setCalendars([]);
                } finally {
                    setLoadingCalendars(false);
                }
            } else {
                setCalendars([]);
            }
        } catch (error) {
            console.error("Failed to check connection status:", error);
            setConnectionStatus({ isConnected: false, email: null });
        } finally {
            setLoadingStatus(false);
        }
    }, []);

    useEffect(() => {
        checkStatus();
    }, [checkStatus]);
    
    useEffect(() => {
        setSettings(initialSettings);
    }, [initialSettings]);

    const handleConnect = async () => {
        try {
            const authUrl = await GCal.getGoogleAuthUrl();
            const popup = window.open(authUrl, 'google-auth', 'width=500,height=600');
            
            // Periodically check if the popup is closed
            const checkPopup = setInterval(() => {
                if (!popup || popup.closed) {
                    clearInterval(checkPopup);
                    // Refresh status after popup is closed
                    checkStatus();
                }
            }, 1000);

        } catch (error) {
            console.error("Google connection failed:", error);
            alert("Impossibile avviare la connessione con Google. Controlla la console per i dettagli.");
        }
    };

    const handleDisconnect = async () => {
        if (window.confirm("Sei sicuro di voler disconnettere il tuo account Google? Le prenotazioni non verranno più sincronizzate.")) {
            await GCal.disconnectGoogleAccount();
            checkStatus(); // Refresh status
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
        await updateAppSettings({
            locationCalendarMapping: settings.locationCalendarMapping,
            selectedCalendarIds: settings.selectedCalendarIds
        });
        onSettingsChange();
        setSaving(false);
        alert("Impostazioni salvate!");
    };
    
    return (
        <div className="space-y-12">
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-2 text-white">Integrazione Google Calendar</h2>
                <p className="text-gray-400 mb-6">Collega il tuo account Google per sincronizzare automaticamente le prenotazioni con il tuo calendario.</p>

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
                    <div className="bg-gray-900/50 border border-gray-700 p-4 rounded-lg flex items-center justify-between">
                        <div>
                            <p className="font-semibold text-yellow-300">Stato: Non Connesso</p>
                            <p className="text-gray-300">Collega il tuo account per iniziare.</p>
                        </div>
                        <button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">Connetti a Google</button>
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
