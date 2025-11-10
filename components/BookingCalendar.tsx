import React, { useState, useEffect, useCallback } from 'react';
import { collection, addDoc, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db, getAppSettings } from '../services/firebase';
import * as GCal from '../services/googleCalendar';
import { type AppUser, type Booking } from '../types';
import Spinner from './Spinner';

interface BookingCalendarProps {
  user: AppUser;
  mode: 'admin'; // Rimosso 'client'
}

const BookingCalendar: React.FC<BookingCalendarProps> = ({ user }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busySlots, setBusySlots] = useState<Date[]>([]);
  
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [service, setService] = useState<string>('');
  const [bookingState, setBookingState] = useState<'idle' | 'booking' | 'success' | 'error'>('idle');

  const fetchEventsAndBookings = useCallback(async () => {
    setLoading(true);
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    let gCalBusyTimes: Date[] = [];
    const connection = await GCal.checkGoogleConnection();
    setIsConnected(connection.isConnected);

    if (connection.isConnected) {
        const appSettings = await getAppSettings();
        const calendarIds = appSettings?.selectedCalendarIds?.length ? appSettings.selectedCalendarIds : ['primary'];
        
        const busyIntervals = await GCal.getBusySlots(today.toISOString(), nextWeek.toISOString(), calendarIds);

        gCalBusyTimes = busyIntervals.flatMap(interval => {
            if (!interval.start || !interval.end) return [];
            const start = new Date(interval.start);
            const end = new Date(interval.end);
            const slots = [];
            for (let d = new Date(start); d < end; d.setHours(d.getHours() + 1)) {
                slots.push(new Date(d));
            }
            return slots;
        });
    }

    if (db) {
        const bookingsQuery = query(
        collection(db, "bookings"),
        where("startTime", ">=", Timestamp.fromDate(today)),
        where("startTime", "<=", Timestamp.fromDate(nextWeek))
        );
        const querySnapshot = await getDocs(bookingsQuery);
        const firestoreBusyTimes = querySnapshot.docs.map(doc => (doc.data().startTime as Timestamp).toDate());
        
        const allBusySlots = [...gCalBusyTimes, ...firestoreBusyTimes];
        setBusySlots(allBusySlots);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEventsAndBookings();
  }, [fetchEventsAndBookings]);
  
  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !clientName || !clientEmail || !db) return;

    setBookingState('booking');
    const endTime = new Date(selectedSlot.getTime() + 60 * 60 * 1000);
    
    try {
      let gcalEventId: string | undefined = undefined;
      if (isConnected) {
        const appSettings = await getAppSettings();
        // Per semplicità, in questa vista usiamo il primo calendario mappato o il primario.
        const firstMappedCalendar = appSettings?.locationCalendarMapping ? Object.values(appSettings.locationCalendarMapping)[0] : undefined;
        const calendarId = firstMappedCalendar || 'primary';
        
        const eventData = {
          clientName: clientName,
          clientEmail: clientEmail,
          sport: service,
          lessonType: 'N/A',
          duration: 60,
          location: 'N/A',
          startTime: selectedSlot.toISOString(),
          endTime: endTime.toISOString(),
          targetCalendarId: calendarId,
        };

        const result = await GCal.createCalendarEvent(eventData);
        if (result.eventCreated && result.eventId) {
            gcalEventId = result.eventId;
        }
      }

      const newBooking: Omit<Booking, 'id'> = {
        ownerUid: user.uid,
        clientName,
        clientEmail,
        clientPhone: '', // Non raccolto in questa vista
        sport: service,
        lessonType: 'N/A',
        duration: 60,
        location: 'N/A',
        startTime: selectedSlot,
        endTime,
        status: 'confirmed',
        gcalEventId,
      };

      await addDoc(collection(db, "bookings"), newBooking);
      
      setBookingState('success');
      fetchEventsAndBookings();
      setTimeout(() => {
          closeModal();
      }, 2000);
    } catch (error) {
      console.error("Booking failed:", error);
      setBookingState('error');
    }
  };

  const closeModal = () => {
    setSelectedSlot(null);
    setClientName('');
    setClientEmail('');
    setService('');
    setBookingState('idle');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-10"><Spinner /> Caricamento calendario...</div>
    );
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    return date;
  });

  const timeSlots = Array.from({ length: 12 }, (_, i) => { // 8 AM to 7 PM
    const date = new Date();
    date.setHours(8 + i, 0, 0, 0);
    return date;
  });
  
  const isSlotBusy = (slot: Date) => {
    return busySlots.some(busySlot => 
      busySlot.getFullYear() === slot.getFullYear() &&
      busySlot.getMonth() === slot.getMonth() &&
      busySlot.getDate() === slot.getDate() &&
      busySlot.getHours() === slot.getHours()
    );
  };
  
  const title = 'Dashboard Calendario';

  return (
    <>
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <h2 className="text-3xl font-bold mb-6 text-center text-white">{title}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
          {days.map(day => (
            <div key={day.toISOString()} className="border border-gray-700 rounded-lg p-3 bg-gray-900/50">
              <p className="font-bold text-center text-emerald-400">{day.toLocaleDateString('it-IT', { weekday: 'short' })}</p>
              <p className="text-center text-sm text-gray-400 mb-3">{day.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}</p>
              <div className="flex flex-col gap-2">
                {timeSlots.map(time => {
                  const slotDate = new Date(day);
                  slotDate.setHours(time.getHours(), 0, 0, 0);
                  const isBusy = isSlotBusy(slotDate);
                  const isPast = slotDate < new Date();

                  return (
                    <button
                      key={time.getHours()}
                      disabled={isBusy || isPast}
                      onClick={() => setSelectedSlot(slotDate)}
                      className={`w-full text-sm font-semibold p-2 rounded-md transition-colors ${
                        isPast ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed' :
                        isBusy ? 'bg-red-900/40 text-red-400 line-through cursor-not-allowed' : 
                        'bg-gray-700 text-gray-200 hover:bg-emerald-600 hover:text-white'
                      }`}
                    >
                      {time.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Booking Modal */}
      {selectedSlot && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={closeModal}>
          <div className="bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-8 relative border border-gray-700" onClick={e => e.stopPropagation()}>
            <button onClick={closeModal} className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 text-3xl font-bold">&times;</button>
            {bookingState === 'success' ? (
                <div className="text-center py-8">
                    <div className="mx-auto bg-green-500/10 rounded-full h-16 w-16 flex items-center justify-center ring-4 ring-green-500/20">
                        <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <h3 className="text-2xl font-bold mt-4 text-white">Prenotazione Confermata!</h3>
                    <p className="text-gray-300 mt-2">Un evento è stato aggiunto al calendario.</p>
                </div>
            ) : (
                <form onSubmit={handleBooking}>
                    <h3 className="text-2xl font-bold mb-2 text-white">Conferma Prenotazione</h3>
                    <p className="text-gray-400 mb-6">
                        Stai prenotando per il {selectedSlot.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} alle {selectedSlot.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    
                    <div className="mb-4">
                        <label htmlFor="service" className="block text-sm font-medium text-gray-300 mb-1">Tipo di Lezione</label>
                        <input type="text" id="service" value={service} onChange={(e) => setService(e.target.value)} required className="w-full p-2 bg-gray-700 border border-gray-600 rounded-lg text-white" placeholder="Es. Tennis, Padel..." />
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

                    <button type="submit" disabled={bookingState === 'booking'} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center disabled:bg-emerald-800">
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
