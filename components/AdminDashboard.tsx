import React, { useState, useEffect, useCallback, useRef } from 'react';
import { type AppUser, type AppSettings, type Service, type GoogleCalendar, type LessonType, type DurationOption, type LocationOption, type AvailabilityRule, type DayAvailability } from '../types';
import Header from './Header';
import Spinner from './Spinner';
import * as GCal from '../services/googleCalendar';
import { getAppSettings, updateAppSettings, uploadProfilePhoto } from '../services/firebase';
import { useGoogleCalendar } from '../contexts/GoogleCalendarContext';

interface AdminDashboardProps {
  user: AppUser;
}

type Tab = 'settings' | 'personalization' | 'integrations';

interface TabProps {
    settings: AppSettings;
    onSettingsChange: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ user }) => {
  const [activeTab, setActiveTab] = useState<Tab>('settings');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    const appSettings = await getAppSettings();
    setSettings(appSettings);
  }, []);

  useEffect(() => {
    setLoading(true);
    refreshSettings().finally(() => setLoading(false));
  }, [refreshSettings]);


  const renderTabContent = () => {
    if (loading) {
        return <div className="flex justify-center py-10"><Spinner /></div>;
    }
    if (!settings) {
        return <p className="text-center text-red-400">Impossibile caricare le impostazioni.</p>;
    }

    switch (activeTab) {
      case 'settings':
        return <BookingSettingsTab settings={settings} onSettingsChange={refreshSettings} />;
      case 'personalization':
        return <PersonalizationTab settings={settings} onSettingsChange={refreshSettings} />;
      case 'integrations':
        return <IntegrationsTab settings={settings} onSettingsChange={refreshSettings} />;
      default:
        return <BookingSettingsTab settings={settings} onSettingsChange={refreshSettings} />;
    }
  }

  return (
    <div className="min-h-screen bg-gray-900">
      <Header user={user} appLogoUrl={settings?.profilePhotoUrl} />
      <main className="container mx-auto p-4 md:p-8">
        <div className="mb-8 border-b border-gray-700">
          <nav className="-mb-px flex space-x-6" aria-label="Tabs">
            <TabButton name="Impostazioni Prenotazioni" tab="settings" activeTab={activeTab} setActiveTab={setActiveTab} />
            <TabButton name="Personalizzazione" tab="personalization" activeTab={activeTab} setActiveTab={setActiveTab} />
            <TabButton name="Integrazioni" tab="integrations" activeTab={activeTab} setActiveTab={setActiveTab} />
          </nav>
        </div>
        <div>{renderTabContent()}</div>
      </main>
    </div>
  );
};

const TabButton: React.FC<{name: string, tab: Tab, activeTab: Tab, setActiveTab: (tab: Tab) => void}> = ({ name, tab, activeTab, setActiveTab }) => (
    <button
        onClick={() => setActiveTab(tab)}
        className={`${
        activeTab === tab
            ? 'border-emerald-400 text-emerald-400'
            : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'
        } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-lg transition-colors`}
    >
        {name}
    </button>
);

// =================================================================
// Booking Settings Tab
// =================================================================
const BookingSettingsTab: React.FC<TabProps> = ({ settings: initialSettings, onSettingsChange }) => {
    const [settings, setSettings] = useState<AppSettings>(initialSettings);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setSettings(initialSettings);
    }, [initialSettings]);

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
    
    const updateAvailabilitySlotInterval = (locationId: string, interval: number) => {
        setSettings(prev => {
            if (!prev) return prev;
            const newAvailability = { ...prev.availability };
            const locationRule = newAvailability[locationId] || { dayOverrides: {}, slotInterval: 60 };
            locationRule.slotInterval = interval;
            newAvailability[locationId] = locationRule;
            return { ...prev, availability: newAvailability };
        });
    };
    
    const updateDayOverride = (locationId: string, dayIndex: number, rule: Partial<DayAvailability>) => {
        setSettings(prev => {
            if (!prev) return prev;
            const newAvailability = JSON.parse(JSON.stringify(prev.availability || {}));

            const locationRule = newAvailability[locationId] || { dayOverrides: {}, slotInterval: 60 };
            
            const dayRule = locationRule.dayOverrides[dayIndex] || { enabled: false, startTime: '09:00', endTime: '18:00' };

            locationRule.dayOverrides[dayIndex] = { ...dayRule, ...rule };
            newAvailability[locationId] = locationRule;

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

    if (!settings) return <p>Impossibile caricare le impostazioni.</p>;
    
    const weekDays = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

    return (
        <div className="space-y-12">
            <CrudSection<LocationOption>
                title="Gestione Sedi"
                items={settings.locations || []}
                setItems={(newItems) => updateField('locations', newItems)}
                renderItem={(item) => <span>{item.name}</span>}
                newItemFactory={() => ({ id: `loc-${Date.now()}`, name: '' })}
                renderEditForm={(item, setItem) => (
                    <input type="text" value={item.name} onChange={e => setItem({ ...item, name: e.target.value })} placeholder="Nome Sede (es. Salò)" className="flex-grow p-2 bg-gray-700 border border-gray-600 text-white rounded-lg"/>
                )}
            />

            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-6 text-white">Regole Generali di Prenotazione</h2>
                 <div>
                    <label htmlFor="bookingNotice" className="block text-sm font-medium text-gray-300 mb-1">
                      Preavviso minimo di prenotazione
                    </label>
                    <p className="text-sm text-gray-500 mb-2">
                      Impedisci le prenotazioni last-minute. Gli utenti non potranno prenotare slot prima che sia trascorso questo tempo.
                    </p>
                    <select
                      id="bookingNotice"
                      value={settings.bookingNoticeHours || 12}
                      onChange={e => updateField('bookingNoticeHours', parseInt(e.target.value, 10))}
                      className="w-full max-w-xs p-2 bg-gray-700 border border-gray-600 rounded-lg"
                    >
                      <option value="1">1 ora</option>
                      <option value="3">3 ore</option>
                      <option value="6">6 ore</option>
                      <option value="12">12 ore</option>
                      <option value="24">24 ore</option>
                      <option value="48">48 ore (2 giorni)</option>
                    </select>
                </div>
            </div>
            
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-6 text-white">Regole di Disponibilità per Sede</h2>
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
                                                <input
                                                  type="checkbox"
                                                  checked={dayRule.enabled}
                                                  onChange={e => updateDayOverride(loc.id, index, { enabled: e.target.checked })}
                                                  className="h-5 w-5 rounded border-gray-500 bg-gray-700 text-emerald-500 focus:ring-emerald-500"
                                                />
                                                <label className="ml-3 font-medium text-gray-200">{day}</label>
                                            </div>
                                            <div className="md:col-span-3 flex items-center gap-4">
                                                 <input 
                                                    type="time" 
                                                    value={dayRule.startTime}
                                                    disabled={!dayRule.enabled}
                                                    onChange={e => updateDayOverride(loc.id, index, { startTime: e.target.value })} 
                                                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg disabled:bg-gray-800 disabled:cursor-not-allowed"
                                                />
                                                <span className="text-gray-500">-</span>
                                                <input 
                                                    type="time" 
                                                    value={dayRule.endTime}
                                                    disabled={!dayRule.enabled}
                                                    onChange={e => updateDayOverride(loc.id, index, { endTime: e.target.value })} 
                                                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg disabled:bg-gray-800 disabled:cursor-not-allowed"
                                                />
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                             <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1">Intervallo Slot</label>
                                <select value={settings.availability?.[loc.id]?.slotInterval || 60} onChange={e => updateAvailabilitySlotInterval(loc.id, parseInt(e.target.value))} className="w-full max-w-xs p-2 bg-gray-700 border border-gray-600 rounded-lg">
                                    <option value="15">15 minuti</option>
                                    <option value="30">30 minuti</option>
                                    <option value="45">45 minuti</option>
                                    <option value="60">60 minuti (1 ora)</option>
                                    <option value="90">90 minuti (1.5 ore)</option>
                                </select>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Impostazioni per Sport */}
            <div className="space-y-8">
                {settings.services?.map(sport => (
                    <div key={sport.id} className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                        <h2 className="text-2xl font-bold mb-6 text-white">Gestione Impostazioni per <span className="text-emerald-400">{sport.name}</span></h2>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <CrudSection<LessonType>
                                title="Tipi di Lezione"
                                items={settings.sportSettings?.[sport.id]?.lessonTypes || []}
                                setItems={(newItems) => updateSportSetting(sport.id, 'lessonTypes', newItems)}
                                renderItem={(item) => <span>{item.name}</span>}
                                newItemFactory={() => ({ id: `type-${sport.id}-${Date.now()}`, name: '' })}
                                renderEditForm={(item, setItem) => (
                                    <input type="text" value={item.name} onChange={e => setItem({ ...item, name: e.target.value })} placeholder="Nome Lezione (es. Individuale)" className="flex-grow p-2 bg-gray-700 border border-gray-600 text-white rounded-lg"/>
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
                                        <input type="number" value={item.value} onChange={e => setItem({ ...item, value: parseInt(e.target.value) || 0 })} step="15" className="w-24 p-2 bg-gray-700 border border-gray-600 text-white rounded-lg"/>
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
                    {saving ? <Spinner /> : 'Salva Tutte le Impostazioni'}
                </button>
            </div>
        </div>
    );
};


// =================================================================
// Generic CRUD Section Component
// =================================================================
interface CrudSectionProps<T extends { id: string }> {
    title: string;
    items: T[];
    setItems: (newItems: T[]) => void;
    renderItem: (item: T) => React.ReactNode;
    newItemFactory: () => T;
    renderEditForm: (item: T, setItem: (item: T) => void) => React.ReactNode;
}

function CrudSection<T extends { id: string }>({ title, items, setItems, renderItem, newItemFactory, renderEditForm }: CrudSectionProps<T>) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingItem, setEditingItem] = useState<T | null>(null);
    
    const [newItem, setNewItem] = useState<T>(newItemFactory());

    const handleAdd = () => {
        // @ts-ignore
        if (newItem.name === '' || (newItem.value !== undefined && newItem.value <= 0)) return;
        setItems([...items, newItem]);
        setNewItem(newItemFactory());
    };
    
    const handleEdit = (item: T) => {
        setEditingId(item.id);
        setEditingItem(item);
    }

    const handleSaveEdit = () => {
        if (!editingItem) return;
        setItems(items.map(item => item.id === editingId ? editingItem : item));
        setEditingId(null);
        setEditingItem(null);
    };

    const handleDelete = (id: string) => {
        if (window.confirm("Sei sicuro di voler eliminare questo elemento?")) {
            setItems(items.filter(item => item.id !== id));
        }
    };

    return (
        <div className="border border-gray-700 p-6 rounded-lg bg-gray-900/50">
            <h3 className="text-xl font-bold mb-4 text-white">{title}</h3>
            <div className="space-y-3 mb-6 min-h-[6rem]">
                {items.map(item => (
                    <div key={item.id} className="flex items-center gap-4 p-3 bg-gray-700 rounded-lg shadow-sm">
                        {editingId === item.id && editingItem ? (
                            <>
                                {renderEditForm(editingItem, setEditingItem)}
                                <button onClick={handleSaveEdit} className="text-green-400 font-semibold">Salva</button>
                                <button onClick={() => setEditingId(null)} className="text-gray-400">Annulla</button>
                            </>
                        ) : (
                            <>
                                <div className="flex-grow text-gray-200">{renderItem(item)}</div>
                                <button onClick={() => handleEdit(item)} className="text-blue-400 font-semibold">Modifica</button>
                                <button onClick={() => handleDelete(item.id)} className="text-red-400 font-semibold">Elimina</button>
                            </>
                        )}
                    </div>
                ))}
                 {items.length === 0 && <p className="text-gray-500 text-center py-4">Nessun elemento aggiunto.</p>}
            </div>
            <div className="border-t border-gray-700 pt-6">
                <h4 className="text-lg font-semibold mb-3 text-white">Aggiungi Nuovo</h4>
                <div className="flex items-center gap-4">
                    {renderEditForm(newItem, setNewItem)}
                    <button onClick={handleAdd} className="bg-emerald-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-emerald-700">Aggiungi</button>
                </div>
            </div>
        </div>
    );
}



// =================================================================
// Personalization Tab
// =================================================================
const PersonalizationTab: React.FC<TabProps> = ({ settings: initialSettings, onSettingsChange }) => {
    const [settings, setSettings] = useState<AppSettings>(initialSettings);
    const [saving, setSaving] = useState(false);
    const [imageFile, setImageFile] = useState<File | null>(null);

    const [newServiceName, setNewServiceName] = useState('');
    const [newServiceEmoji, setNewServiceEmoji] = useState('');

    const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
    const [editingServiceData, setEditingServiceData] = useState<{ name: string; emoji: string }>({ name: '', emoji: '' });

    const editFileInputRef = useRef<HTMLInputElement>(null);
    const addFileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setSettings(initialSettings);
    }, [initialSettings]);

    const handleSave = async () => {
        if (!settings) return;
        setSaving(true);
        let updatedSettings: Partial<AppSettings> = { ...settings };

        if (imageFile) {
            const photoUrl = await uploadProfilePhoto(imageFile);
            updatedSettings.profilePhotoUrl = photoUrl;
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
                lessonTypes: [{ id: 'default-type', name: 'Lezione Standard' }],
                durations: [{ id: 'default-dur', value: 60 }]
            }
        };

        await updateAppSettings({ services: updatedServices, sportSettings: newSportSettings });
        onSettingsChange();
        setNewServiceName('');
        setNewServiceEmoji('');
    };

    const handleDeleteService = async (serviceId: string) => {
        if (!window.confirm("Sei sicuro di voler eliminare questo sport? Questo eliminerà anche le sue impostazioni di lezione e durata.") || !settings) return;
        
        const updatedServices = settings.services?.filter(s => s.id !== serviceId);
        
        const newSportSettings = { ...settings.sportSettings };
        delete newSportSettings[serviceId];

        await updateAppSettings({ services: updatedServices, sportSettings: newSportSettings });
        onSettingsChange();
    };
    
    const handleEditServiceClick = (service: Service) => {
        setEditingServiceId(service.id);
        setEditingServiceData({ name: service.name, emoji: service.emoji });
    };

    const handleCancelEdit = () => {
        setEditingServiceId(null);
        setEditingServiceData({ name: '', emoji: '' });
    };

    const handleSaveService = async (serviceId: string) => {
        if (!settings?.services || !editingServiceData.name || !editingServiceData.emoji) return;

        const updatedServices = settings.services.map(s =>
            s.id === serviceId ? { ...s, ...editingServiceData } : s
        );

        await updateAppSettings({ services: updatedServices });
        onSettingsChange();
        handleCancelEdit();
    };
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setter: (value: string) => void) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onloadend = () => {
                setter(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };


    if (!settings) return null;

    return (
        <div className="space-y-12">
            {/* Sezione Profilo e Pagina Benvenuto */}
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-6 text-white">Profilo e Pagina di Benvenuto</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-1">
                        <label className="block text-sm font-medium text-gray-300 mb-1">Foto Profilo</label>
                        <img src={settings.profilePhotoUrl || 'https://via.placeholder.com/150'} alt="Profile" className="w-32 h-32 rounded-full object-cover mb-2 border-4 border-gray-700" />
                        <input type="file" onChange={(e) => setImageFile(e.target.files ? e.target.files[0] : null)} className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-500/10 file:text-emerald-300 hover:file:bg-emerald-500/20" />
                    </div>
                    <div className="md:col-span-2 space-y-4">
                        <div>
                            <label htmlFor="welcomeTitle" className="block text-sm font-medium text-gray-300 mb-1">Titolo di Benvenuto</label>
                            <input type="text" id="welcomeTitle" value={settings.welcomeTitle || ''} onChange={(e) => setSettings({...settings, welcomeTitle: e.target.value})} className="w-full p-2 bg-gray-700 border border-gray-600 text-white rounded-lg" />
                        </div>
                        <div>
                            <label htmlFor="welcomeMessage" className="block text-sm font-medium text-gray-300 mb-1">Messaggio di Benvenuto</label>
                            <textarea id="welcomeMessage" value={settings.welcomeMessage || ''} onChange={(e) => setSettings({...settings, welcomeMessage: e.target.value})} rows={4} className="w-full p-2 bg-gray-700 border border-gray-600 text-white rounded-lg" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Sezione Gestione Servizi */}
            <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
                <h2 className="text-2xl font-bold mb-6 text-white">Gestione Sport Principali</h2>
                <div className="space-y-4 mb-8">
                    {settings.services?.map(service => {
                        const isImage = service.emoji.startsWith('data:image/');
                        return (
                            <div key={service.id} className="flex items-center gap-4 p-3 bg-gray-700/80 rounded-lg">
                                {editingServiceId === service.id ? (
                                    <>
                                        <div className="flex items-center">
                                            <input
                                                type="text"
                                                value={editingServiceData.emoji}
                                                onChange={e => setEditingServiceData({ ...editingServiceData, emoji: e.target.value })}
                                                className="w-24 p-2 bg-gray-600 border border-gray-500 rounded-l-lg text-center text-sm"
                                                placeholder="Icona"
                                            />
                                            <button
                                                type="button"
                                                title="Carica immagine"
                                                onClick={() => editFileInputRef.current?.click()}
                                                className="p-2 bg-gray-600 rounded-r-lg border-t border-b border-r border-gray-500 hover:bg-gray-500"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                                </svg>
                                            </button>
                                            <input type="file" ref={editFileInputRef} style={{ display: 'none' }} accept="image/*" onChange={(e) => handleFileChange(e, (val) => setEditingServiceData(d => ({ ...d, emoji: val })))} />
                                        </div>
                                        <input
                                            type="text"
                                            value={editingServiceData.name}
                                            onChange={e => setEditingServiceData({ ...editingServiceData, name: e.target.value })}
                                            className="flex-grow p-2 bg-gray-600 border border-gray-500 rounded-lg"
                                        />
                                        <button onClick={() => handleSaveService(service.id)} className="text-green-400 font-semibold hover:text-green-300">Salva</button>
                                        <button onClick={handleCancelEdit} className="text-gray-400 hover:text-gray-200">Annulla</button>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-12 h-10 flex items-center justify-center">
                                            {isImage ? (
                                                <img src={service.emoji} alt={service.name} className="max-w-full max-h-full object-contain" />
                                            ) : (
                                                <span className="text-3xl">{service.emoji}</span>
                                            )}
                                        </div>
                                        <span className="font-semibold flex-grow text-gray-200">{service.name}</span>
                                        <button onClick={() => handleEditServiceClick(service)} className="text-blue-400 hover:text-blue-300 font-semibold">Modifica</button>
                                        <button onClick={() => handleDeleteService(service.id)} className="text-red-400 hover:text-red-300 font-semibold">Elimina</button>
                                    </>
                                )}
                            </div>
                        )
                    })}
                </div>

                <div className="border-t border-gray-700 pt-6">
                    <h3 className="text-lg font-semibold mb-3 text-white">Aggiungi Nuovo Sport</h3>
                    <div className="flex gap-4 items-center">
                        <input type="text" value={newServiceName} onChange={e => setNewServiceName(e.target.value)} placeholder="Nome (es. Lezione Privata)" className="flex-grow p-2 bg-gray-700 border border-gray-600 rounded-lg" />
                         <div className="flex items-center">
                            <input 
                              type="text" 
                              value={newServiceEmoji} 
                              onChange={e => setNewServiceEmoji(e.target.value)} 
                              placeholder="Icona" 
                              className="w-24 p-2 bg-gray-700 border border-gray-600 rounded-l-lg text-center" 
                            />
                            <button 
                              type="button" 
                              title="Carica immagine" 
                              onClick={() => addFileInputRef.current?.click()} 
                              className="p-2 bg-gray-600 rounded-r-lg border-t border-b border-r border-gray-500 hover:bg-gray-500"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                            </button>
                            <input type="file" ref={addFileInputRef} style={{ display: 'none' }} accept="image/*" onChange={(e) => handleFileChange(e, setNewServiceEmoji)}/>
                        </div>
                        <button onClick={handleAddService} className="bg-emerald-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-emerald-700">Aggiungi</button>
                    </div>
                </div>
            </div>
            
            <div className="flex justify-end">
                <button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg transition flex items-center gap-2 disabled:bg-blue-400">
                    {saving ? <Spinner /> : 'Salva Modifiche Personalizzazione'}
                </button>
            </div>
        </div>
    );
};


// =================================================================
// Integrations Tab
// =================================================================
const IntegrationsTab: React.FC<TabProps> = ({ settings: initialSettings, onSettingsChange }) => {
    const { isReady, isAuthorized, error: authError, connect, disconnect } = useGoogleCalendar();
    const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
    const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
    const [locationCalendarMapping, setLocationCalendarMapping] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [loadingData, setLoadingData] = useState(false);


    useEffect(() => {
        const fetchData = async () => {
            if (isAuthorized) {
                setLoadingData(true);
                const calendarList = await GCal.listCalendars();
                setCalendars(calendarList);
                setLoadingData(false);
            }
        };
        fetchData();
    }, [isAuthorized]);

     useEffect(() => {
        if (initialSettings) {
            setSelectedCalendarIds(new Set(initialSettings.selectedCalendarIds || []));
            setLocationCalendarMapping(initialSettings.locationCalendarMapping || {});
        }
    }, [initialSettings]);
    
    const handleToggleCalendar = (calendarId: string) => {
        const newSet = new Set(selectedCalendarIds);
        if (newSet.has(calendarId)) {
            newSet.delete(calendarId);
            const newMapping = { ...locationCalendarMapping };
            Object.keys(newMapping).forEach(locId => {
                if (newMapping[locId] === calendarId) {
                    delete newMapping[locId];
                }
            });
            setLocationCalendarMapping(newMapping);
        } else {
            newSet.add(calendarId);
        }
        setSelectedCalendarIds(newSet);
    };

    const handleSaveCalendarSettings = async () => {
        setSaving(true);
        const settingsToSave: Partial<AppSettings> = {
            selectedCalendarIds: Array.from(selectedCalendarIds),
            locationCalendarMapping: locationCalendarMapping,
        };
        await updateAppSettings(settingsToSave);
        onSettingsChange();
        setSaving(false);
        alert('Impostazioni del calendario salvate!');
    };


    if (!isReady || loadingData) return <div className="flex justify-center"><Spinner /></div>

    return (
        <div className="bg-gray-800 p-8 rounded-xl border border-gray-700">
            <h2 className="text-2xl font-bold mb-4 text-white">Integrazione con Google Calendar</h2>
            {authError ? (
                <div className="flex items-start gap-4 p-4 bg-red-900/50 border border-red-500/30 text-red-300 rounded-lg">
                    <svg className="h-6 w-6 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <div>
                        <h3 className="font-bold">Errore di Configurazione</h3>
                        <p className="whitespace-pre-wrap">{authError || "Errore during l'inizializzazione dell'API di Google Calendar. Controlla le tue credenziali e ricarica la pagina."}</p>
                    </div>
                </div>
            ) : !isAuthorized ? (
                <div>
                    <p className="text-gray-400 mb-6">Per mostrare le tue disponibilità e aggiungere automaticamente le prenotazioni, collega il tuo account Google.</p>
                    <button
                        onClick={connect}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-transform transform hover:scale-105"
                    >
                        Connetti a Google Calendar
                    </button>
                </div>
            ) : (
                <div className="space-y-8">
                     <div className="flex items-center justify-between gap-4 p-4 bg-green-900/50 border border-green-500/30 text-green-300 rounded-lg">
                        <div className="flex items-center gap-4">
                            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <div>
                                <h3 className="font-bold">Connesso Correttamente</h3>
                                <p>Il tuo calendario Google è collegato.</p>
                            </div>
                        </div>
                        <button onClick={disconnect} className="bg-red-500 text-white font-semibold py-2 px-4 rounded-lg hover:bg-red-600 transition-colors text-sm">Disconnetti da Google</button>
                    </div>

                    <div>
                        <h3 className="text-xl font-semibold text-gray-200 mb-3">1. Seleziona calendari per verificare la disponibilità</h3>
                        <p className="text-gray-400 mb-4">Gli impegni nei calendari selezionati verranno mostrati come non disponibili per le prenotazioni.</p>
                        <div className="space-y-3">
                            {calendars.map(cal => (
                                <div key={cal.id} className="flex items-center p-3 bg-gray-700/60 rounded-md">
                                    <input
                                        id={cal.id}
                                        type="checkbox"
                                        checked={selectedCalendarIds.has(cal.id)}
                                        onChange={() => handleToggleCalendar(cal.id)}
                                        className="h-5 w-5 rounded border-gray-500 bg-gray-600 text-emerald-500 focus:ring-emerald-500"
                                    />
                                    <label htmlFor={cal.id} className="ml-3 block text-sm font-medium text-gray-300">{cal.summary} {cal.primary && '(Principale)'}</label>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h3 className="text-xl font-semibold text-gray-200 mb-3">2. Associa un calendario a ogni sede</h3>
                        <p className="text-gray-400 mb-4">Scegli in quale calendario salvare le nuove prenotazioni per ciascuna sede. Le sedi senza un calendario associato non potranno creare eventi automatici.</p>
                        <div className="space-y-4">
                            {(initialSettings.locations || []).map(loc => (
                                <div key={loc.id} className="grid grid-cols-1 md:grid-cols-3 items-center gap-4">
                                    <label htmlFor={`loc-cal-${loc.id}`} className="font-medium text-gray-300 md:col-span-1">{loc.name}</label>
                                    <select
                                        id={`loc-cal-${loc.id}`}
                                        value={locationCalendarMapping[loc.id] || ''}
                                        onChange={(e) => setLocationCalendarMapping(prev => ({...prev, [loc.id]: e.target.value}))}
                                        className="md:col-span-2 block w-full pl-3 pr-10 py-2 bg-gray-700 border-gray-600 focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm rounded-md"
                                    >
                                        <option value="" disabled>Seleziona un calendario...</option>
                                        {calendars.map(cal => (
                                            <option key={cal.id} value={cal.id}>{cal.summary}</option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    <div className="flex justify-end pt-4 border-t border-gray-700">
                        <button
                            onClick={handleSaveCalendarSettings}
                            disabled={saving}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-lg transition flex items-center gap-2 disabled:bg-emerald-800"
                        >
                            {saving ? <Spinner/> : 'Salva Impostazioni Calendario'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};


export default AdminDashboard;