
import React, { useState, useEffect } from 'react';
import { updateAppSettings } from '../../services/firebase';
import { type AppSettings, type LocationOption, type DayAvailability, type LessonType, type DurationOption } from '../../types';
import { type TabProps } from './types';
import CrudSection from './CrudSection';
import Spinner from '../Spinner';

const BookingSettingsTab: React.FC<TabProps> = ({ settings: initialSettings, onSettingsChange }) => {
    const [settings, setSettings] = useState<AppSettings>(initialSettings);
    const [saving, setSaving] = useState(false);

    useEffect(() => { setSettings(initialSettings); }, [initialSettings]);

    const handleSave = async () => {
        if (!settings) return;
        setSaving(true);
        await updateAppSettings(settings);
        onSettingsChange();
        setSaving(false);
    };

    const updateField = (field: keyof AppSettings, value: any) => {
        setSettings(prev => ( prev ? { ...prev, [field]: value } : prev));
    };
    
    const updateAvailability = (locationId: string, dayIndex: number, rule: Partial<DayAvailability>) => {
        setSettings(prev => {
            if (!prev) return prev;
            const newAvailability = JSON.parse(JSON.stringify(prev.availability || {}));
            const locRule = newAvailability[locationId] || { dayOverrides: {}, slotInterval: 60 };
            const dayRule = locRule.dayOverrides[dayIndex] || { enabled: false, startTime: '09:00', endTime: '18:00' };
            locRule.dayOverrides[dayIndex] = { ...dayRule, ...rule };
            newAvailability[locationId] = locRule;
            return { ...prev, availability: newAvailability };
        });
    };
    
    const updateSlotInterval = (locationId: string, interval: number) => {
        setSettings(prev => {
            if (!prev) return prev;
            const newAvailability = { ...prev.availability };
            const locRule = newAvailability[locationId] || { dayOverrides: {}, slotInterval: 60 };
            locRule.slotInterval = interval;
            newAvailability[locationId] = locRule;
            return { ...prev, availability: newAvailability };
        });
    };

    const updateSportSetting = (sportId: string, key: 'lessonTypes' | 'durations', value: any) => {
        setSettings(prev => {
            if (!prev) return prev;
            const newSportSettings = { ...(prev.sportSettings || {}) };
            newSportSettings[sportId] = {
                ...(newSportSettings[sportId] || { lessonTypes: [], durations: [] }),
                [key]: value
            };
            return { ...prev, sportSettings: newSportSettings };
        });
    };

    if (!settings) return <p>Caricamento impostazioni...</p>;
    
    const weekDays = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];

    return (
        <div className="space-y-12">
            <CrudSection<LocationOption>
                title="Gestione Sedi"
                items={settings.locations || []}
                setItems={(newItems) => updateField('locations', newItems)}
                renderItem={(item) => <span>{item.name}</span>}
                newItemFactory={() => ({ id: `loc-${Date.now()}`, name: '' })}
                renderEditForm={(item, setItem) => (
                    <input type="text" value={item.name} onChange={e => setItem({ ...item, name: e.target.value })} placeholder="Nome Sede" className="flex-grow p-2 bg-gray-700 border border-gray-600 rounded-lg"/>
                )}
            />
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-6 text-white">Regole Generali</h2>
                <label htmlFor="bookingNotice" className="block text-sm font-medium text-gray-300 mb-1">Preavviso minimo</label>
                <p className="text-sm text-gray-500 mb-2">Impedisci le prenotazioni last-minute.</p>
                <select id="bookingNotice" value={settings.bookingNoticeHours || 12}
                    onChange={e => updateField('bookingNoticeHours', parseInt(e.target.value, 10))}
                    className="w-full max-w-xs p-2 bg-gray-700 border border-gray-600 rounded-lg">
                    {[1, 3, 6, 12, 24, 48].map(h => <option key={h} value={h}>{h} or{h > 1 ? 'e' : 'a'}</option>)}
                </select>
            </div>
            
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-6 text-white">Disponibilità per Sede</h2>
                <div className="space-y-8">
                    {(settings.locations || []).map(loc => (
                        <div key={loc.id} className="border border-gray-700 p-6 rounded-lg bg-gray-900/50">
                            <h3 className="text-xl font-bold mb-4 text-emerald-400">{loc.name}</h3>
                            <div className="space-y-4 mb-6">
                                {weekDays.map((day, index) => {
                                    const dayRule = settings.availability?.[loc.id]?.dayOverrides?.[index] ?? { enabled: false, startTime: '09:00', endTime: '18:00' };
                                    return (
                                        <div key={day} className="grid grid-cols-1 md:grid-cols-4 items-center gap-4 p-3 rounded-lg bg-gray-800/60 border border-gray-700">
                                            <div className="md:col-span-1 flex items-center">
                                                <input type="checkbox" checked={dayRule.enabled}
                                                  onChange={e => updateAvailability(loc.id, index, { enabled: e.target.checked })}
                                                  className="h-5 w-5 rounded border-gray-500 bg-gray-700 text-emerald-500 focus:ring-emerald-500"
                                                />
                                                <label className="ml-3 font-medium">{day}</label>
                                            </div>
                                            <div className="md:col-span-3 flex items-center gap-4">
                                                 <input type="time" value={dayRule.startTime} disabled={!dayRule.enabled} onChange={e => updateAvailability(loc.id, index, { startTime: e.target.value })} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg disabled:bg-gray-800"/>
                                                <span>-</span>
                                                <input type="time" value={dayRule.endTime} disabled={!dayRule.enabled} onChange={e => updateAvailability(loc.id, index, { endTime: e.target.value })} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg disabled:bg-gray-800"/>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                            <label className="block text-sm font-medium mb-1">Intervallo Slot</label>
                            <select value={settings.availability?.[loc.id]?.slotInterval || 60} onChange={e => updateSlotInterval(loc.id, parseInt(e.target.value))} className="w-full max-w-xs p-2 bg-gray-700 border border-gray-600 rounded-lg">
                                {[15, 30, 45, 60, 90].map(i => <option key={i} value={i}>{i} minuti</option>)}
                            </select>
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-8">
                {settings.services?.map(sport => (
                    <div key={sport.id} className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                        <h2 className="text-2xl font-bold mb-6 text-white">Impostazioni per <span className="text-emerald-400">{sport.name}</span></h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <CrudSection<LessonType>
                                title="Tipi di Lezione"
                                items={settings.sportSettings?.[sport.id]?.lessonTypes || []}
                                setItems={(newItems) => updateSportSetting(sport.id, 'lessonTypes', newItems)}
                                renderItem={(item) => <span>{item.name}</span>}
                                newItemFactory={() => ({ id: `type-${sport.id}-${Date.now()}`, name: '' })}
                                renderEditForm={(item, setItem) => (
                                    <input type="text" value={item.name} onChange={e => setItem({ ...item, name: e.target.value })} placeholder="Nome Lezione" className="flex-grow p-2 bg-gray-700 border border-gray-600 rounded-lg"/>
                                )}
                            />
                            <CrudSection<DurationOption>
                                title="Durata Lezioni"
                                items={settings.sportSettings?.[sport.id]?.durations || []}
                                setItems={(newItems) => updateSportSetting(sport.id, 'durations', newItems)}
                                renderItem={(item) => <span>{item.value} minuti</span>}
                                newItemFactory={() => ({ id: `dur-${sport.id}-${Date.now()}`, value: 60 })}
                                renderEditForm={(item, setItem) => (
                                    <div className="flex items-center gap-2">
                                        <input type="number" value={item.value} onChange={e => setItem({ ...item, value: parseInt(e.target.value) || 0 })} step="15" className="w-24 p-2 bg-gray-700 border border-gray-600 rounded-lg"/>
                                        <span className="text-gray-300">minuti</span>
                                    </div>
                                )}
                            />
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex justify-end mt-8">
                <button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg transition flex items-center gap-2 disabled:bg-blue-400">
                    {saving ? <Spinner /> : 'Salva Impostazioni'}
                </button>
            </div>
        </div>
    );
};

export default BookingSettingsTab;
