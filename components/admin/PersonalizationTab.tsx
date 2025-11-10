
import React, { useState, useEffect, useRef } from 'react';
import { type AppSettings, type Service } from '../../types';
import { type TabProps } from './types';
import { updateAppSettings, uploadProfilePhoto } from '../../services/firebase';
import Spinner from '../Spinner';

const PersonalizationTab: React.FC<TabProps> = ({ settings: initialSettings, onSettingsChange }) => {
    const [settings, setSettings] = useState<AppSettings>(initialSettings);
    const [saving, setSaving] = useState(false);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [newServiceName, setNewServiceName] = useState('');
    const [newServiceEmoji, setNewServiceEmoji] = useState('');
    const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
    const [editingData, setEditingData] = useState({ name: '', emoji: '' });
    const editFileInputRef = useRef<HTMLInputElement>(null);
    const addFileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { setSettings(initialSettings); }, [initialSettings]);

    const handleSave = async () => {
        if (!settings) return;
        setSaving(true);
        let updatedSettings: Partial<AppSettings> = { ...settings };
        if (imageFile) {
            updatedSettings.profilePhotoUrl = await uploadProfilePhoto(imageFile);
        }
        await updateAppSettings(updatedSettings);
        setImageFile(null);
        onSettingsChange();
        setSaving(false);
    };

    const handleAddService = async () => {
        if (!newServiceName || !newServiceEmoji || !settings) return;
        const newService: Service = {
            id: newServiceName.toLowerCase().replace(/\s/g, '-') + Date.now(),
            name: newServiceName,
            emoji: newServiceEmoji,
        };
        const updatedServices = [...(settings.services || []), newService];
        const newSportSettings = {
            ...(settings.sportSettings || {}),
            [newService.id]: {
                lessonTypes: [{ id: 'default-type', name: 'Standard' }],
                durations: [{ id: 'default-dur', value: 60 }]
            }
        };
        await updateAppSettings({ services: updatedServices, sportSettings: newSportSettings });
        onSettingsChange();
        setNewServiceName('');
        setNewServiceEmoji('');
    };

    const handleDeleteService = async (serviceId: string) => {
        if (!window.confirm("Sei sicuro?") || !settings) return;
        const updatedServices = settings.services?.filter(s => s.id !== serviceId);
        const newSportSettings = { ...settings.sportSettings };
        delete newSportSettings[serviceId];
        await updateAppSettings({ services: updatedServices, sportSettings: newSportSettings });
        onSettingsChange();
    };
    
    const handleSaveService = async (serviceId: string) => {
        if (!settings?.services || !editingData.name || !editingData.emoji) return;
        const updatedServices = settings.services.map(s =>
            s.id === serviceId ? { ...s, ...editingData } : s
        );
        await updateAppSettings({ services: updatedServices });
        onSettingsChange();
        setEditingServiceId(null);
    };
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (value: string) => void) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onloadend = () => { setter(reader.result as string); };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    if (!settings) return null;

    return (
        <div className="space-y-12">
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-6 text-white">Profilo e Benvenuto</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-1">
                        <label className="block text-sm font-medium mb-1">Foto Profilo</label>
                        <img src={settings.profilePhotoUrl || 'about:blank'} alt="Profile" className="w-32 h-32 rounded-full object-cover mb-2 border-4 border-gray-700" />
                        <input type="file" onChange={(e) => setImageFile(e.target.files ? e.target.files[0] : null)} className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-500/10 file:text-emerald-300 hover:file:bg-emerald-500/20" />
                    </div>
                    <div className="md:col-span-2 space-y-4">
                        <div>
                            <label htmlFor="welcomeTitle" className="block text-sm font-medium mb-1">Titolo</label>
                            <input type="text" id="welcomeTitle" value={settings.welcomeTitle || ''} onChange={(e) => setSettings({...settings, welcomeTitle: e.target.value})} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg" />
                        </div>
                        <div>
                            <label htmlFor="welcomeMessage" className="block text-sm font-medium mb-1">Messaggio</label>
                            <textarea id="welcomeMessage" value={settings.welcomeMessage || ''} onChange={(e) => setSettings({...settings, welcomeMessage: e.target.value})} rows={4} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-6 text-white">Gestione Sport</h2>
                <div className="space-y-4 mb-8">
                    {settings.services?.map(service => (
                        <div key={service.id} className="flex items-center gap-4 p-3 bg-gray-700/80 rounded-lg">
                            {editingServiceId === service.id ? (
                                <>
                                    <input type="text" value={editingData.emoji} onChange={e => setEditingData({ ...editingData, emoji: e.target.value })} className="w-24 p-2 bg-gray-600 border border-gray-500 rounded-lg text-center" placeholder="Icona"/>
                                    <input type="text" value={editingData.name} onChange={e => setEditingData({ ...editingData, name: e.target.value })} className="flex-grow p-2 bg-gray-600 border border-gray-500 rounded-lg" />
                                    <button onClick={() => handleSaveService(service.id)} className="text-green-400 font-semibold">Salva</button>
                                    <button onClick={() => setEditingServiceId(null)} className="text-gray-400">Annulla</button>
                                </>
                            ) : (
                                <>
                                    <span className="text-3xl w-12 text-center">{service.emoji}</span>
                                    <span className="font-semibold flex-grow">{service.name}</span>
                                    <button onClick={() => { setEditingServiceId(service.id); setEditingData({ name: service.name, emoji: service.emoji }); }} className="text-blue-400 font-semibold">Modifica</button>
                                    <button onClick={() => handleDeleteService(service.id)} className="text-red-400 font-semibold">Elimina</button>
                                </>
                            )}
                        </div>
                    ))}
                </div>
                <div className="border-t border-gray-700 pt-6">
                    <h3 className="text-lg font-semibold mb-3">Aggiungi Sport</h3>
                    <div className="flex gap-4 items-center">
                        <input type="text" value={newServiceName} onChange={e => setNewServiceName(e.target.value)} placeholder="Nome" className="flex-grow p-2 bg-gray-700 border border-gray-600 rounded-lg" />
                        <input type="text" value={newServiceEmoji} onChange={e => setNewServiceEmoji(e.target.value)} placeholder="Icona" className="w-24 p-2 bg-gray-700 border border-gray-600 rounded-lg text-center" />
                        <button onClick={handleAddService} className="bg-emerald-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-emerald-700">Aggiungi</button>
                    </div>
                </div>
            </div>
            
            <div className="flex justify-end">
                <button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg transition flex items-center gap-2 disabled:bg-blue-400">
                    {saving ? <Spinner /> : 'Salva Personalizzazione'}
                </button>
            </div>
        </div>
    );
};

export default PersonalizationTab;
