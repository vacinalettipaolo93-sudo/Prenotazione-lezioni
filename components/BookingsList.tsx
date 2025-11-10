import React, { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, orderBy, Timestamp, limit } from 'firebase/firestore';
import { db } from '../services/firebase';
import { type Booking } from '../types';
import { ADMIN_UID } from '../constants';
import Spinner from './Spinner';

const BookingsList: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');

  const fetchBookings = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    
    const now = Timestamp.now();
    let bookingsQuery;

    if (view === 'upcoming') {
      bookingsQuery = query(
        collection(db, "bookings"),
        where("ownerUid", "==", ADMIN_UID),
        where("startTime", ">=", now),
        orderBy("startTime", "asc"),
        limit(50)
      );
    } else { // 'past'
      bookingsQuery = query(
        collection(db, "bookings"),
        where("ownerUid", "==", ADMIN_UID),
        where("startTime", "<", now),
        orderBy("startTime", "desc"),
        limit(50)
      );
    }

    try {
      const querySnapshot = await getDocs(bookingsQuery);
      const fetchedBookings: Booking[] = querySnapshot.docs.map(doc => {
        // FIX: Cast `doc.data()` to `any` to resolve errors related to spreading and accessing properties on an `unknown` type.
        const data = doc.data() as any;
        return {
          id: doc.id,
          ...data,
          startTime: (data.startTime as Timestamp).toDate(),
          endTime: (data.endTime as Timestamp).toDate(),
        } as Booking;
      });
      setBookings(fetchedBookings);
    } catch (error) {
      console.error("Error fetching bookings:", error);
      // Handle error state in UI
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const StatusBadge: React.FC<{ status?: 'pending' | 'confirmed' | 'cancelled' }> = ({ status }) => {
    const statusInfo = {
      confirmed: { text: 'Confermata', color: 'bg-green-500/20 text-green-300' },
      pending: { text: 'In attesa', color: 'bg-yellow-500/20 text-yellow-300' },
      cancelled: { text: 'Annullata', color: 'bg-red-500/20 text-red-300' },
    };
    const currentStatus = status && statusInfo[status] ? statusInfo[status] : statusInfo.pending;
    return <span className={`px-2 py-1 text-xs font-semibold rounded-full ${currentStatus.color}`}>{currentStatus.text}</span>;
  };

  return (
    <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-white">Elenco Prenotazioni</h2>
        <div className="flex gap-2 p-1 rounded-lg bg-gray-700">
          <button
            onClick={() => setView('upcoming')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition ${view === 'upcoming' ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
          >
            Prossime
          </button>
          <button
            onClick={() => setView('past')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition ${view === 'past' ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-600'}`}
          >
            Passate
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Spinner />
        </div>
      ) : bookings.length === 0 ? (
        <p className="text-center text-gray-500 py-20">Nessuna prenotazione trovata.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-gray-600 text-sm text-gray-400">
              <tr>
                <th className="p-3">Data e Ora</th>
                <th className="p-3">Cliente</th>
                <th className="p-3 hidden md:table-cell">Contatti</th>
                <th className="p-3">Dettagli Lezione</th>
                <th className="p-3">Stato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {bookings.map(booking => (
                <tr key={booking.id} className="hover:bg-gray-700/50 transition-colors">
                  <td className="p-3 font-medium text-white">
                    <div>{booking.startTime.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                    <div className="text-sm text-gray-400">{booking.startTime.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} - {booking.endTime.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td className="p-3 text-gray-200">{booking.clientName}</td>
                   <td className="p-3 text-gray-400 text-sm hidden md:table-cell">
                     <div>{booking.clientEmail}</div>
                     <div>{booking.clientPhone}</div>
                   </td>
                  <td className="p-3 text-gray-300">
                    <div>{booking.sport} - {booking.lessonType}</div>
                    <div className="text-sm text-gray-400">{booking.location} ({booking.duration} min)</div>
                  </td>
                  <td className="p-3"><StatusBadge status={booking.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default BookingsList;