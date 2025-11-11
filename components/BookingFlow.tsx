import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { collection, addDoc, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db, getAppSettings } from '../services/firebase';
import * as GCal from '../services/googleCalendar';
import { type Booking, type AppSettings, type AICompletions } from '../types';
import Spinner from './Spinner';
import { ADMIN_UID } from '../constants';

interface BookingFlowProps {
  sport: string;
  prefilled: AICompletions | null;
}

const BookingFlow: React.FC<BookingFlowProps> = ({ sport, prefilled }) => {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busySlots, setBusySlots] = useState<Date[]>([]);
    
    // 1: Date, 2: Location, 3: Time, 4: Lesson Details, 5: Client Details
    const [step, setStep] = useState(1); 

    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
    const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);

    // Step 4 State
    const [lessonTypeId, setLessonTypeId] = useState<string>('');
    const [durationValue, setDurationValue] = useState<number>(0);

    // Step 5 State
    const [clientName, setClientName] = useState('');
    const [clientEmail, setClientEmail] = useState('');
    const [clientPhone, setClientPhone] = useState('');
    const [message, setMessage] = useState('');

    const [bookingState, setBookingState] = useState<'idle' | 'booking' | 'success' | 'error'>('idle');
    const [aiNotice, setAiNotice] = useState<string | null>(null);
    
    const selectedService = useMemo(() => {
        return settings?.services?.find(s => s.name === sport);
    }, [settings?.services, sport]);

    const sportSettings = useMemo(() => {
        if (!selectedService || !settings?.sportSettings) return { lessonTypes: [], durations: [] };
        return settings.sportSettings[selectedService.id] || { lessonTypes: [], durations: [] };
    }, [selectedService, settings?.sportSettings]);


    // Initialize and fetch settings
    useEffect(() => {
        const initialize = async () => {
            setLoading(true);
            setError(null);
            try {
                const appSettings = await getAppSettings();
                setSettings(appSettings);
            } catch (e) {
                console.error("Failed to fetch settings:", e);
                setError("Impossibile caricare le impostazioni. Riprova più tardi.");
            } finally {
                setLoading(false);
            }
        };
        initialize();
    }, []);

    // Handle prefilled data from AI
    useEffect(() => {
        if (prefilled && settings) {
            let nextStep = 1;
            const notices: string[] = [];
            
            if (prefilled.date) {
                // Adjust for timezone differences by parsing date as UTC
                const dateParts = prefilled.date.split('-').map(Number);
                const parsedDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));

                if (!isNaN(parsedDate.getTime())) {
                    setSelectedDate(parsedDate);
                    setCurrentMonth(parsedDate);
                    nextStep = 2;
                    notices.push("la data");
                }
            }

            if (prefilled.location) {
                const foundLocation = settings.locations?.find(loc => loc.name.toLowerCase() === prefilled.location?.toLowerCase());
                if (foundLocation) {
                    setSelectedLocationId(foundLocation.id);
                    if (nextStep === 2) {
                        nextStep = 3;
                    }
                     if (notices.indexOf("la sede") === -1) {
                        notices.push("la sede");
                    }
                }
            }

            if (notices.length > 0) {
                setAiNotice(`Ho pre-compilato ${notices.join(' e ')} per te!`);
                setTimeout(() => setAiNotice(null), 5000); // Nascondi dopo 5 secondi
            }

            setStep(nextStep);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefilled, settings]);

    // Set initial defaults for lesson/duration once sport settings are available
    useEffect(() => {
        if(sportSettings.lessonTypes.length > 0 && !lessonTypeId) {
            setLessonTypeId(sportSettings.lessonTypes[0].id);
        }
        if(sportSettings.durations.length > 0 && !durationValue) {
            setDurationValue(sportSettings.durations[0].value);
        }
    }, [sportSettings, lessonTypeId, durationValue]);


    const fetchBusySlots = useCallback(async (date: Date) => {
        setLoading(true);
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        let allBusySlots: Date[] = [];

        try {
            // Chiamata alla funzione backend per gli slot di Google Calendar
            if (settings?.selectedCalendarIds?.length) {
                const busyIntervals = await GCal.getBusySlots(startOfDay.toISOString(), endOfDay.toISOString(), settings.selectedCalendarIds);
                const gCalBusyTimes = busyIntervals.flatMap(interval => {
                    const start = new Date(interval.start);
                    const end = new Date(interval.end);
                    const slots = [];
                    for (let d = new Date(start); d < end; d.setMinutes(d.getMinutes() + 30)) {
                        slots.push(new Date(d));
                    }
                    return slots;
                });
                allBusySlots = allBusySlots.concat(gCalBusyTimes);
            }

            // Query a Firestore per le prenotazioni esistenti
            if (db) {
                const bookingsQuery = query(
                    collection(db, "bookings"),
                    where("startTime", ">=", Timestamp.fromDate(startOfDay)),
                    where("startTime", "<=", Timestamp.fromDate(endOfDay))
                );
                const querySnapshot = await getDocs(bookingsQuery);
                const firestoreBusyTimes = querySnapshot.docs.flatMap(doc => {
                    const data = doc.data();
                    const start = (data.startTime as Timestamp).toDate();
                    const end = (data.endTime as Timestamp).toDate();
                    const slots = [];
                    for (let d = new Date(start); d < end; d.setMinutes(d.getMinutes() + 30)) {
                         slots.push(new Date(d));
                    }
                    return slots;
                });
                allBusySlots = allBusySlots.concat(firestoreBusyTimes);
            }
            
            setBusySlots(allBusySlots);
        } catch (e) {
            console.error("Failed to fetch busy slots:", e);
            setError("Impossibile caricare le disponibilità. Riprova tra poco.");
        } finally {
            setLoading(false);
        }
    }, [settings?.selectedCalendarIds]);

    useEffect(() => {
        if(step === 3){
            fetchBusySlots(selectedDate);
        }
    }, [step, selectedDate, fetchBusySlots]);

    const handleBooking = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedSlot || !clientName || !clientEmail || !clientPhone || !db || !selectedLocationId) return;
  
      setBookingState('booking');
      const endTime = new Date(selectedSlot.getTime() + durationValue * 60 * 1000);
      const locationName = settings?.locations?.find(l => l.id === selectedLocationId)?.name || 'N/A';
      const lessonTypeName = sportSettings.lessonTypes.find(l => l.id === lessonTypeId)?.name || 'N/A';
      
      const targetCalendarId = settings?.locationCalendarMapping?.[selectedLocationId];
  
      try {
        let gcalEventId: string | undefined = undefined;
  
        // Se è stato configurato un calendario per questa sede, prova a creare l'evento
        if (targetCalendarId) {
            const eventData = {
                clientName,
                clientEmail,
                clientPhone,
                sport,
                lessonType: lessonTypeName,
                duration: durationValue,
                location: locationName,
                startTime: selectedSlot.toISOString(),
                endTime: endTime.toISOString(),
                message,
                targetCalendarId,
            };
            const result = await GCal.createCalendarEvent(eventData);
            if (result.eventCreated) {
                gcalEventId = result.eventId || undefined;
            }
        }
  
        // Salviamo la prenotazione su Firebase, includendo l'ID dell'evento di Google Calendar se creato.
        const newBooking: Omit<Booking, 'id'> = {
          ownerUid: ADMIN_UID,
          clientName,
          clientEmail,
          clientPhone,
          sport,
          lessonType: lessonTypeName,
          duration: durationValue,
          location: locationName,
          startTime: selectedSlot,
          endTime,
          message,
          targetCalendarId,
          status: gcalEventId ? 'confirmed' : 'pending',
          gcalEventId,
        };
  
        await addDoc(collection(db, "bookings"), newBooking);
        setBookingState('success');
  
      } catch (error) {
        console.error("La prenotazione è fallita:", error);
        setBookingState('error');
      }
    };

    const generatedTimeSlots = useMemo(() => {
        if (!selectedLocationId || !settings?.availability) return [];
        
        const dayIndex = selectedDate.getDay();
        const locationRule = settings.availability[selectedLocationId];
        const dayRule = locationRule?.dayOverrides?.[dayIndex];
        
        if (!dayRule || !dayRule.enabled) {
            return [];
        }

        const slots = [];
        const [startHour, startMinute] = dayRule.startTime.split(':').map(Number);
        const [endHour, endMinute] = dayRule.endTime.split(':').map(Number);

        const startDate = new Date(selectedDate);
        startDate.setHours(startHour, startMinute, 0, 0);

        const endDate = new Date(selectedDate);
        endDate.setHours(endHour, endMinute, 0, 0);
        
        for (let d = new Date(startDate); d < endDate; d.setMinutes(d.getMinutes() + locationRule.slotInterval)) {
            slots.push(new Date(d));
        }
        return slots;

    }, [selectedDate, selectedLocationId, settings?.availability]);
    
    // UI Rendering
    if (loading && !settings) {
      return <div className="flex items-center justify-center p-10"><Spinner /> Caricamento...</div>;
    }
    
    if (error) return (
        <div className="bg-gray-800 rounded-2xl shadow-xl max-w-lg mx-auto p-8 text-center border border-red-700">
            <h2 className="text-2xl font-bold text-red-400">Errore</h2>
            <p className="text-gray-300 mt-4">{error}</p>
        </div>
    );

    const handleAddToCalendar = () => {
        if (!selectedSlot) return;

        const startTime = selectedSlot;
        const endTime = new Date(startTime.getTime() + durationValue * 60 * 1000);
        const locationName = settings?.locations?.find(l => l.id === selectedLocationId)?.name || '';

        const formatGoogleDate = (date: Date) => date.toISOString().replace(/-|:|\.\d\d\d/g, '');

        const event = {
            action: 'TEMPLATE',
            text: `Lezione di ${sport}`,
            dates: `${formatGoogleDate(startTime)}/${formatGoogleDate(endTime)}`,
            location: locationName,
            details: `Promemoria per la tua lezione di ${sport}. La prenotazione verrà confermata a breve dal maestro.`
        };

        const params = new URLSearchParams(event);
        const url = `https://www.google.com/calendar/render?${params.toString()}`;
        
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    if (bookingState === 'success') {
        return (
            <div className="bg-gray-800 rounded-2xl shadow-xl max-w-lg mx-auto p-8 text-center border border-gray-700">
                 <div className="mx-auto bg-green-500/10 rounded-full h-16 w-16 flex items-center justify-center ring-4 ring-green-500/20">
                    <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                </div>
                <h2 className="text-3xl font-bold mt-4 text-white">Richiesta Inviata!</h2>
                <p className="text-gray-300 mt-2">
                    La tua richiesta è stata ricevuta. Riceverai una conferma definitiva a breve.
                    Nel frattempo, puoi aggiungere un promemoria al tuo calendario.
                </p>
                <div className="mt-8 space-y-4">
                     <button 
                        onClick={handleAddToCalendar} 
                        className="w-full bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold py-3 px-6 rounded-lg border-2 border-gray-600 transition-colors flex items-center justify-center gap-2"
                     >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" /></svg>
                        Aggiungi a Google Calendar
                    </button>
                    <button onClick={() => window.location.reload()} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-lg">
                        Fai un'altra prenotazione
                    </button>
                </div>
            </div>
        );
    }
    
    const renderCalendar = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
    
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
    
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);
        const daysInMonth = lastDayOfMonth.getDate();
    
        const startDayIndex = (firstDayOfMonth.getDay() === 0 ? 6 : firstDayOfMonth.getDay() -1) ; // Lunedì = 0
    
        const calendarDays = [];
        for (let i = 0; i < startDayIndex; i++) {
            calendarDays.push(<div key={`empty-${i}`} className="p-1"></div>);
        }
    
        for (let i = 1; i <= daysInMonth; i++) {
            const date = new Date(year, month, i);
            const isPast = date < today;
            const isSelected = selectedDate.toDateString() === date.toDateString();
            const isToday = today.toDateString() === date.toDateString();
    
            calendarDays.push(
                <button
                    key={i}
                    disabled={isPast}
                    onClick={() => { setSelectedDate(date); setStep(2); }}
                    className={`
                        w-12 h-12 rounded-full flex items-center justify-center text-center transition-all duration-200 font-medium relative
                        ${isPast ? 'text-gray-600 cursor-not-allowed' : 'hover:bg-gray-700'}
                        ${isSelected ? 'bg-emerald-600 text-white font-bold shadow-lg scale-110' : ''}
                        ${!isSelected && isToday ? 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-gray-800' : ''}
                    `}
                >
                    {i}
                </button>
            );
        }
    
        const handlePrevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
        const handleNextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
        const monthName = currentMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    
        return (
            <div className="mb-8 max-w-sm mx-auto">
                <div className="flex items-center justify-between mb-4">
                    <button onClick={handlePrevMonth} className="p-2 rounded-full hover:bg-gray-700 transition-colors">
                        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <h3 className="text-lg font-semibold capitalize w-48 text-center text-white">{monthName}</h3>
                    <button onClick={handleNextMonth} className="p-2 rounded-full hover:bg-gray-700 transition-colors">
                        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
                <div className="grid grid-cols-7 gap-2 text-center text-gray-400 font-medium mb-2">
                    {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map(day => <div key={day}>{day}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-y-2 place-items-center">
                    {calendarDays}
                </div>
            </div>
        );
    };

    const renderLocationSelector = () => (
        <div>
            <div className="flex flex-wrap justify-center gap-4">
                {settings?.locations?.map(loc => (
                    <button key={loc.id} onClick={() => { setSelectedLocationId(loc.id); setStep(3); }} className="px-6 py-3 rounded-lg font-semibold transition text-lg bg-gray-700 text-gray-200 hover:bg-emerald-600 hover:text-white shadow-sm">
                        {loc.name}
                    </button>
                ))}
            </div>
            <div className="mt-8">
                <button onClick={() => setStep(1)} className="font-semibold text-gray-400 hover:text-white">&larr; Cambia Data</button>
            </div>
        </div>
    );
    
    const renderTimeSlots = () => {
        const isSlotBusy = (slot: Date) => busySlots.some(busySlot => Math.abs(busySlot.getTime() - slot.getTime()) < 15 * 60 * 1000);
        
        const noticeHours = settings?.bookingNoticeHours || 12; // Default 12 ore
        const noticeCutoffDate = new Date(new Date().getTime() + noticeHours * 60 * 60 * 1000);

        return (
            <div>
                 {loading ? <div className="flex justify-center"><Spinner/></div> : (
                    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {generatedTimeSlots.length > 0 ? generatedTimeSlots.map(slot => {
                            const isBusy = isSlotBusy(slot);
                            const isWithinNoticePeriod = slot < noticeCutoffDate;
                            return (
                                <button key={slot.toISOString()} disabled={isBusy || isWithinNoticePeriod} onClick={() => { setSelectedSlot(slot); setStep(4); }} className={`p-3 rounded-lg font-semibold transition-colors border ${isWithinNoticePeriod ? 'border-gray-700 text-gray-600 cursor-not-allowed' : isBusy ? 'border-gray-700 text-gray-500 line-through cursor-not-allowed' : 'border-gray-600 text-gray-200 hover:bg-emerald-600 hover:border-emerald-600 hover:text-white'}`}>
                                    {slot.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                </button>
                            );
                        }) : <p className="col-span-full text-center text-gray-500 py-8">Nessun orario disponibile per questa data o sede.</p>}
                    </div>
                )}
                <div className="mt-8">
                    <button onClick={() => setStep(2)} className="font-semibold text-gray-400 hover:text-white">&larr; Cambia Sede</button>
                </div>
            </div>
        )
    };

    const renderLessonDetailsForm = () => (
        <div>
            <div className="space-y-6">
                <div>
                    <h3 className="font-semibold text-gray-200 mb-2">Tipologia di Lezione</h3>
                    <div className="flex flex-wrap gap-3">
                        {sportSettings.lessonTypes.map(type => (
                            <button key={type.id} onClick={() => setLessonTypeId(type.id)} className={`px-4 py-2 rounded-lg font-medium transition ${lessonTypeId === type.id ? 'bg-emerald-600 text-white shadow' : 'bg-gray-700 hover:bg-gray-600'}`}>{type.name}</button>
                        ))}
                         {sportSettings.lessonTypes.length === 0 && <p className="text-gray-500">Nessun tipo di lezione configurato per questo sport.</p>}
                    </div>
                </div>
                 <div>
                    <h3 className="font-semibold text-gray-200 mb-2">Durata</h3>
                    <div className="flex flex-wrap gap-3">
                        {sportSettings.durations.map(d => (
                            <button key={d.id} onClick={() => setDurationValue(d.value)} className={`px-4 py-2 rounded-lg font-medium transition ${durationValue === d.value ? 'bg-emerald-600 text-white shadow' : 'bg-gray-700 hover:bg-gray-600'}`}>{d.value} min</button>
                        ))}
                        {sportSettings.durations.length === 0 && <p className="text-gray-500">Nessuna durata configurata per questo sport.</p>}
                    </div>
                </div>
            </div>
            <div className="flex justify-between mt-8 pt-6 border-t border-gray-700">
                <button onClick={() => { setStep(3); setSelectedSlot(null); }} className="font-semibold text-gray-400 hover:text-white">Indietro</button>
                <button 
                    onClick={() => setStep(5)}
                    disabled={!lessonTypeId || !durationValue} 
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-6 rounded-lg disabled:bg-emerald-800 disabled:cursor-not-allowed">
                        Continua
                </button>
            </div>
        </div>
    );

    const renderClientDetailsForm = () => {
        const locationName = settings?.locations?.find(l => l.id === selectedLocationId)?.name || '';
        const lessonTypeName = sportSettings.lessonTypes.find(l => l.id === lessonTypeId)?.name || '';

        return (
            <form onSubmit={handleBooking}>
                <div className="mb-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                    <h3 className="font-bold text-lg mb-3 text-white">Riepilogo Prenotazione</h3>
                    <div className="text-gray-300 space-y-2">
                        <p><strong>Sport:</strong> {sport}</p>
                        <p><strong>Quando:</strong> {selectedSlot?.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} alle {selectedSlot?.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>
                        <p><strong>Sede:</strong> {locationName}</p>
                        <p><strong>Tipo:</strong> {lessonTypeName}, {durationValue} min</p>
                    </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Nome e Cognome" required className="w-full p-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-emerald-500" />
                    <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="Email" required className="w-full p-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="mb-4">
                    <input type="tel" value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="Numero di Telefono" required className="w-full p-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div className="mb-6">
                    <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Note aggiuntive (opzionale)" rows={3} className="w-full p-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-emerald-500" />
                </div>

                {bookingState === 'error' && <p className="text-red-400 text-center mb-4">Errore durante la prenotazione. Riprova.</p>}

                <div className="flex flex-col items-center">
                    <button type="submit" disabled={bookingState === 'booking'} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center disabled:bg-emerald-800">
                        {bookingState === 'booking' ? <Spinner /> : `Invia Richiesta`}
                    </button>
                    <p className="text-sm text-amber-400/80 mt-3 text-center uppercase"><strong>LA PRENOTAZIONE VERRÀ CONFERMATA DOPO LA PRENOTAZIONE DEL CAMPO DA PARTE DEL MAESTRO</strong></p>
                </div>
                <div className="mt-8 text-left">
                    <button type="button" onClick={() => setStep(4)} className="font-semibold text-gray-400 hover:text-white">&larr; Torna ai dettagli</button>
                </div>
            </form>
        )
    };

    const stepInfo: {[key: number]: {title: string, progress: string}} = {
        1: { title: "Seleziona una data", progress: "1 di 5" },
        2: { title: "Seleziona una sede", progress: "2 di 5" },
        3: { title: `Scegli un orario per il ${selectedDate.toLocaleDateString('it-IT', {day: 'numeric', month: 'long'})}`, progress: "3 di 5" },
        4: { title: "Scegli i dettagli della lezione", progress: "4 di 5" },
        5: { title: "Completa la tua prenotazione", progress: "5 di 5" }
    }

    return (
        <div className="bg-gray-800 rounded-2xl shadow-xl max-w-4xl mx-auto p-8 border border-gray-700 relative">
            {aiNotice && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-auto bg-emerald-600 text-white text-sm font-semibold py-2 px-4 rounded-full shadow-lg whitespace-nowrap z-10">
                    {aiNotice}
                </div>
            )}
            <div className="text-center mb-8">
                <p className="text-sm font-semibold text-emerald-400 tracking-wider">PASSO {stepInfo[step].progress}</p>
                <h1 className="text-3xl font-bold text-white mt-2">{stepInfo[step].title}</h1>
            </div>
            
            {step === 1 && renderCalendar()}
            {step === 2 && renderLocationSelector()}
            {step === 3 && renderTimeSlots()}
            {step === 4 && renderLessonDetailsForm()}
            {step === 5 && renderClientDetailsForm()}
        </div>
    );
};

export default BookingFlow;