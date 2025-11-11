

import React, { useState, useEffect, useCallback } from 'react';
import { type AppSettings, type GoogleCalendar } from '../../types';
import { type TabProps } from './types';
import { updateAppSettings } from '../../services/firebase';
import * as GCal from '../../services/googleCalendar';
import Spinner from '../Spinner';

// FIX: Define an explicit interface for the status state to prevent type inference issues.
interface StatusState {
    isLoading: boolean;
    isConnected: boolean;
    email: string | null;
    error?: string;
}

const IntegrationsTab: React.FC<TabProps> = ({ settings: initialSettings, onSettingsChange }) => {
    const [status, setStatus] = useState<StatusState>({ isLoading: true, isConnected: false, email: null });
    const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [loadingData, setLoadingData] = useState(false);

    const checkStatus = useCallback(async () => {
        setStatus(prev => ({ ...prev, isLoading: true }));
        try {
            const data = await GCal.checkGoogleConnection();
            setStatus({ ...data, isLoading: false });
        } catch (e: any) {
            setStatus({ isConnected: false, email: null, error: e.message, isLoading: false });
        }
    }, []);

    useEffect(() => { checkStatus(); }, [checkStatus]);

    useEffect(() => {
        const fetchCalendars = async () => {
            if (!status.isConnected) { setCalendars([]); return; }
            setLoadingData(true);
            try {
                setCalendars(await GCal.listCalendars());
            } catch(e: any) {
                setStatus(prev => ({...prev, error: "Impossibile caricare i calendari."}));
            } finally {
                setLoadingData(false);
            }
        };
        fetchCalendars();
    }, [status.isConnected]);

     useEffect(() => {
        if (initialSettings) {
            setSelectedIds(new Set(initialSettings.selectedCalendarIds || []));
            setMapping(initialSettings.locationCalendarMapping || {});
        }
    }, [initialSettings]);
    
    const handleToggleCalendar = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleSave = async () => {
        setSaving(true);
        await updateAppSettings({
            selectedCalendarIds: Array.from(selectedIds),
            locationCalendarMapping: mapping,
        });
        onSettingsChange();
        setSaving(false);
        alert('Impostazioni salvate!');
    };
    
    const handleConnect = async () => {
        // Apri il popup immediatamente al click per evitare i blocchi del browser.
        const authPopup = window.open('about:blank', 'google-auth', 'width=600,height=700');
        if (!authPopup) {
            setStatus(prev => ({ ...prev, isLoading: false, error: 'Popup bloccato. Abilita i popup per questo sito e riprova.' }));
            return;
        }
    
        try {
            // Recupera l'URL di autenticazione dal nostro backend.
            const url = await GCal.getGoogleAuthUrl();
            
            // Indirizza il popup alla pagina di login di Google.
            authPopup.location.href = url;
    
            // Controlla periodicamente se il popup è stato chiuso dall'utente.
            const timer = setInterval(() => {
                if (authPopup.closed) {
                    clearInterval(timer);
                    // Una volta chiuso, aggiorna lo stato della connessione.
                    checkStatus();
                }
            }, 500);
    
        } catch (e: any) {
            // Se qualcosa va storto, mostra un errore e chiudi il popup.
            setStatus(prev => ({ ...prev, isLoading: false, error: e.message }));
            if (!authPopup.closed) {
                authPopup.close();
            }
        }
    };
    
    const handleDisconnect = async () => {
        if (!window.confirm("Sei sicuro?")) return;
        try {
            await GCal.disconnectGoogleAccount();
            checkStatus();
        } catch (e: any) {
            setStatus(prev => ({...prev, error: e.message}));
        }
    };

    if (status.isLoading) return <div className="flex justify-center"><Spinner /></div>;

    return (
        <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
            <h2 className="text-2xl font-bold mb-4 text-white">Google Calendar</h2>
            {status.error && (
                 <div className="p-4 mb-6 bg-red-900/50 border border-red-500/30 text-red-300 rounded-lg">
                    <h3 className="font-bold">Errore</h3>
                    <p>{status.error}</p>
                </div>
            )}
            
            {!status.isConnected ? (
                <div>
                    <p className="text-gray-400 mb-6">Collega il tuo account Google per la gestione automatica delle disponibilità.</p>
                    <button onClick={handleConnect} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg">
                        Connetti a Google Calendar
                    </button>
                </div>
            ) : (
                <div className="space-y-8">
                    <div className="flex items-center justify-between p-4 bg-green-900/50 border border-green-500/30 text-green-300 rounded-lg">
                        <div>
                            <h3 className="font-bold">Connesso</h3>
                            <p>Account: {status.email}</p>
                        </div>
                        <button onClick={handleDisconnect} className="bg-red-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-red-600 text-sm">Disconnetti</button>
                    </div>
                    {loadingData ? <div className="flex justify-center"><Spinner /></div> : (
                    <>
                        <div>
                            <h3 className="text-xl font-semibold mb-3">1. Seleziona calendari per la disponibilità</h3>
                            <p className="text-gray-400 mb-4">Gli impegni in questi calendari bloccheranno gli slot prenotabili.</p>
                            <div className="space-y-3">
                                {calendars.map(cal => (
                                    <div key={cal.id} className="flex items-center p-3 bg-gray-700/60 rounded-md">
                                        <input id={cal.id} type="checkbox" checked={selectedIds.has(cal.id ?? '')} onChange={() => handleToggleCalendar(cal.id ?? '')} className="h-5 w-5 rounded border-gray-500 bg-gray-600 text-emerald-500 focus:ring-emerald-500" />
                                        <label htmlFor={cal.id} className="ml-3 block text-sm font-medium">{cal.summary} {cal.primary && '(Principale)'}</label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h3 className="text-xl font-semibold mb-3">2. Associa un calendario a ogni sede</h3>
                            <p className="text-gray-400 mb-4">Scegli dove salvare le nuove prenotazioni per ogni sede.</p>
                            <div className="space-y-4">
                                {(initialSettings.locations || []).map(loc => (
                                    <div key={loc.id} className="grid grid-cols-1 md:grid-cols-3 items-center gap-4">
                                        <label htmlFor={`loc-${loc.id}`} className="font-medium md:col-span-1">{loc.name}</label>
                                        <select id={`loc-${loc.id}`} value={mapping[loc.id] || ''} onChange={(e) => setMapping(prev => ({...prev, [loc.id]: e.target.value}))} className="md:col-span-2 block w-full p-2 bg-gray-700 border-gray-600 rounded-md">
                                            <option value="" disabled>Seleziona un calendario...</option>
                                            {calendars.map(cal => <option key={cal.id} value={cal.id}>{cal.summary}</option>)}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>
                    
                        <div className="flex justify-end pt-4 border-t border-gray-700">
                            <button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-lg flex items-center gap-2 disabled:bg-emerald-800">
                                {saving ? <Spinner/> : 'Salva Impostazioni'}
                            </button>
                        </div>
                    </>
                    )}
                </div>
            )}
        </div>
    );
};

export default IntegrationsTab;