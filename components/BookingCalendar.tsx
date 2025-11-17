import React, { useState, useEffect, useCallback } from 'react';
import { getAppSettings } from '../services/firebase';
import * as GCal from '../services/googleCalendar';
import { type AppUser } from '../types';
import Spinner from './Spinner';
import { fetchBusySlotsForWindow, createBooking } from '../services/functionsClient';

interface BookingCalendarProps {
  user: AppUser;
  mode: 'admin'; // Rimosso 'client'
}

const BookingCalendar: React.FC<BookingCalendarProps> = ({ user }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [availableSlots, setAvailableSlots] = useState<Date[]>([]);
  
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [service, setService] = useState<string>('');
  const [bookingState, setBookingState] = useState<'idle' | 'booking' | 'success' | 'error'>('idle');

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(today.getDate() + 7);

      const appSettings = await getAppSettings();
      const locationId = appSettings?.locations?.[0]?.id;
      if (!locationId) { setAvailableSlots([]); setLoading(false); return; }

      // Use the cloud function to return available slots across the window (duration from settings)
      const slotInterval = appSettings?.availability?.[locationId]?.slotInterval || 60;
      try {
        const slots = await fetchBusySlotsForWindow(locationId, today.toISOString(), nextWeek.toISOString(), slotInterval, slotInterval);
        const dates = slots.map((s: any) => new Date(s.startISO));
        setAvailableSlots(dates);
      } catch (err) {
        console.warn("fetchBusySlotsForWindow failed, fallback to GCal/empty:", err);
        // Fallback: we can still attempt GCal busy retrieval if server-side not configured
        try {
          const connection = await GCal.getGoogleConnectionStatus();
          setIsConnected(connection.isConnected);
          if (connection.isConnected) {
            const listSettings = await getAppSettings();
            const calendarIds = listSettings?.selectedCalendarIds?.length ? listSettings.selectedCalendarIds : ['primary'];
            const busyIntervals = await GCal.getBusySlots(today.toISOString(), nextWeek.toISOString(), calendarIds);
            const gCalBusyTimes = busyIntervals.flatMap((interval: any) => {
              if (!interval.start || !interval.end) return [];
              const start = new Date(interval.start);
              const end = new Date(interval.end);
              const slots: Date[] = [];
              for (let d = new Date(start); d < end; d.setMinutes(d.getMinutes() + slotInterval)) {
                slots.push(new Date(d));
              }
              return slots;
            });
            setAvailableSlots(gCalBusyTimes); // this represents busy times; UI can invert logic as needed
          } else {
            setAvailableSlots([]);
          }
        } catch (gerr) {
          console.error("GCal fallback failed:", gerr);
          setAvailableSlots([]);
        }
      }
    } catch (err) {
      console.error("fetchSlots top-level error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !clientName || !clientEmail) return;

    setBookingState('booking');
    try {
      const payload = {
        locationId: 'GAVARDO', // adapt if you have location context, or derive dynamically
        dateISO: selectedSlot.toISOString(),
        durationMinutes: 60,
        clientName,
        clientEmail,
        sport: service,
        message: ''
      };
      const resp = await createBooking(payload);
      if (resp?.success) {
        setBookingState('success');
        // remove booked slot from UI
        setAvailableSlots(prev => prev.filter(d => d.getTime() !== selectedSlot.getTime()));
      } else {
        setBookingState('error');
      }
    } catch (err) {
      console.error("Booking failed:", err);
      setBookingState('error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-10"><Spinner /> Caricamento calendario...</div>
    );
  }

  // render UI using availableSlots as the source of truth for free times (if function returned available slots)
  return (
    <>
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <h2 className="text-3xl font-bold mb-6 text-center text-white">Dashboard Calendario</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
          {Array.from({ length: 7 }, (_, i) => {
            const day = new Date();
            day.setDate(day.getDate() + i);
            const slotsForDay = availableSlots.filter(s =>
              s.getFullYear() === day.getFullYear() &&
              s.getMonth() === day.getMonth() &&
              s.getDate() === day.getDate()
            );
            return (
              <div key={i} className="border border-gray-700 rounded-lg p-3 bg-gray-900/50">
                <p className="font-bold text-center text-emerald-400">{day.toLocaleDateString('it-IT', { weekday: 'short' })}</p>
                <p className="text-center text-sm text-gray-400 mb-3">{day.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}</p>
                <div className="flex flex-col gap-2">
                  {slotsForDay.length === 0 ? <div className="text-sm text-gray-400">Nessuno slot</div> : slotsForDay.map(s => (
                    <button key={s.toISOString()} onClick={() => setSelectedSlot(s)} className="w-full text-sm p-2 bg-gray-700 rounded">
                      {s.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedSlot && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={() => setSelectedSlot(null)}>
          <div className="bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-8 relative border border-gray-700" onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedSlot(null)} className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 text-3xl font-bold">&times;</button>
            {bookingState === 'success' ? (
                <div className="text-center py-8">
                    <div className="mx-auto bg-green-500/10 rounded-full h-16 w-16 flex items-center justify-center ring-4 ring-green-500/20">
                        <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <h3 className="text-2xl font-bold mt-4 text-white">Prenotazione Confermata!</h3>
                    <p className="text-gray-300 mt-2">Un evento è stato aggiunto al calendario (se configurato).</p>
                </div>
            ) : (
                <form onSubmit={handleBooking}>
                    <h3 className="text-2xl font-bold mb-2 text-white">Conferma Prenotazione</h3>
                    <p className="text-gray-400 mb-6">
                        Stai prenotando per il {selectedSlot.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} alle {selectedSlot.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    
                    <div className="mb-4">
                        <label htmlFor="service" className="block text-sm font-medium text-gray-300 mb-1">Tipo di Lezione</label>
                        <input type="text" id="service" value={service} onChange={(e) => setService(e.target.value)} required className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg text-white" />
                    </div>

                    <div className="mb-4">
                        <label htmlFor="clientName" className="block text-sm font-medium text-gray-300 mb-1">Nome Cliente</label>
                        <input type="text" id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} required className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg text-white" />
                    </div>

                    <div className="mb-6">
                        <label htmlFor="clientEmail" className="block text-sm font-medium text-gray-300 mb-1">Email Cliente</label>
                        <input type="email" id="clientEmail" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} required className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg text-white" />
                    </div>
                    
                    {bookingState === 'error' && <p className="text-red-400 text-center mb-4">Errore durante la prenotazione. Riprova.</p>}

                    <button type="submit" disabled={bookingState === 'booking'} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center">
                        {bookingState === 'booking' ? <Spinner /> : 'Conferma'}
                    </button>
                </form>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default BookingCalendar;
