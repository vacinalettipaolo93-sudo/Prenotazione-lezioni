import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { getCalendarService, getAllConnectedCalendars, checkBusyFreebusy, createEvent, ensureCalendarInList } from './calendarUtils';

admin.initializeApp();
const db = admin.firestore();

function makeSlotId(location: string, startISO: string) {
  return `${location.replace(/\s+/g, '_')}_${startISO}`;
}

async function acquireLock(slotId: string, ttlSeconds = 60) {
  const ref = db.collection('slotLocks').doc(slotId);
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + ttlSeconds * 1000);
  try {
    await ref.create({
      createdAt: now,
      expiresAt,
    });
    return { ok: true, ref };
  } catch (e: any) {
    return { ok: false, error: e };
  }
}

async function releaseLock(slotId: string) {
  try {
    await db.collection('slotLocks').doc(slotId).delete();
  } catch (e) {
    console.warn('releaseLock error', e);
  }
}

async function getLocationCalendarId(location: string, sportType: string): Promise<string | null> {
  const doc = await db.collection('settings').doc('default').get();
  if (!doc.exists) return null;
  const data = doc.data() || {};
  const locations: any = data.locations || {};
  const loc = locations[location];
  if (!loc || !loc.calendars) return null;
  return loc.calendars[sportType] || null;
}

export const checkSlotFree = functions.https.onRequest(async (req, res) => {
  try {
    const { startISO, endISO } = req.method === 'GET' ? req.query : req.body;
    if (!startISO || !endISO) return res.status(400).json({ error: 'startISO and endISO required' });

    const calendarService = await getCalendarService();
    const allCalendars = await getAllConnectedCalendars(calendarService);
    const { anyBusy, busyMap } = await checkBusyFreebusy(calendarService, allCalendars, startISO as string, endISO as string);
    return res.json({ ok: true, anyBusy, busyMap });
  } catch (err: any) {
    console.error('checkSlotFree error', err);
    return res.status(500).json({ error: 'internal', detail: err.message || err });
  }
});

export const createBooking = functions.https.onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const { startISO, endISO, location, sportType, user, attendees } = req.body || {};
    if (!startISO || !endISO || !location || !sportType || !user) {
      return res.status(400).json({ error: 'missing parameters' });
    }

    const targetCalendarId = await getLocationCalendarId(location, sportType);
    if (!targetCalendarId) return res.status(400).json({ error: 'no calendar mapped for this location/sportType' });

    const slotId = makeSlotId(location, startISO);
    const lock = await acquireLock(slotId, 60);
    if (!lock.ok) {
      return res.status(409).json({ error: 'slot locked or concurrent booking in progress' });
    }

    const calendarService = await getCalendarService();

    try {
      try {
        await ensureCalendarInList(calendarService, targetCalendarId);
      } catch (e) {
        console.warn('ensureCalendarInList warning', e);
      }

      const allCalendars = await getAllConnectedCalendars(calendarService);
      const { anyBusy } = await checkBusyFreebusy(calendarService, allCalendars, startISO, endISO);
      if (anyBusy) {
        await releaseLock(slotId);
        return res.status(409).json({ error: 'slot busy in one or more calendars' });
      }

      const bookingData = {
        summary: `${sportType} - Prenotazione ${user.name || user.email}`,
        description: `Prenotazione creata da ${user.email}`,
        startISO,
        endISO,
        timeZone: 'Europe/Rome',
        attendees: attendees || undefined,
      };
      const event = await createEvent(calendarService, targetCalendarId, bookingData);

      const bookingDoc = {
        userId: user.id || user.email,
        userName: user.name || null,
        userEmail: user.email,
        start: admin.firestore.Timestamp.fromDate(new Date(startISO)),
        end: admin.firestore.Timestamp.fromDate(new Date(endISO)),
        location,
        sportType,
        calendarId: targetCalendarId,
        eventId: event.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'confirmed'
      };
      const docRef = await db.collection('bookings').add(bookingDoc);

      await releaseLock(slotId);

      return res.json({ ok: true, bookingId: docRef.id, eventId: event.id, calendarId: targetCalendarId });
    } catch (innerErr: any) {
      await releaseLock(slotId);
      console.error('createBooking inner error', innerErr);
      return res.status(500).json({ error: 'error creating booking', detail: innerErr.message || innerErr });
    }
  } catch (err: any) {
    console.error('createBooking error', err);
    return res.status(500).json({ error: 'internal', detail: err.message || err });
  }
});