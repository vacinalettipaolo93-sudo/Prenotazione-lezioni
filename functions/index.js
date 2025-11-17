const functions = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

admin.initializeApp();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "256kb" }));

// Helper: parse payload and return { locationId, startDate, endDate, slotDurationMinutes, slotStepMinutes }
function parseRequestBody(body) {
  const slotDurationMinutes = Number(body.slotDurationMinutes || body.durationMinutes || 30);
  const slotStepMinutes = Number(body.slotStepMinutes || body.stepMinutes || slotDurationMinutes);

  // Case A: { locationId, dateISO } => whole day
  if (body.locationId && body.dateISO) {
    const d = new Date(body.dateISO);
    if (isNaN(d)) throw new Error("Invalid dateISO");
    const startOfDay = new Date(d);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(startOfDay.getDate() + 1);
    return { locationId: body.locationId, startDate: startOfDay, endDate: endOfDay, slotDurationMinutes, slotStepMinutes };
  }

  // Case B: { locationId, data: { timeMin, timeMax } } (Google-like)
  if (body.locationId && body.data && (body.data.timeMin || body.data.timeMax)) {
    const timeMin = body.data.timeMin ? new Date(body.data.timeMin) : null;
    const timeMax = body.data.timeMax ? new Date(body.data.timeMax) : null;
    if ((timeMin && isNaN(timeMin)) || (timeMax && isNaN(timeMax))) throw new Error("Invalid timeMin/timeMax");
    const startDate = timeMin || new Date(0);
    const endDate = timeMax || new Date(8640000000000000);
    return { locationId: body.locationId, startDate, endDate, slotDurationMinutes, slotStepMinutes };
  }

  // Case C: maybe body.data contains locationId
  if (body.data && body.data.locationId && (body.data.timeMin || body.data.timeMax)) {
    const timeMin = body.data.timeMin ? new Date(body.data.timeMin) : null;
    const timeMax = body.data.timeMax ? new Date(body.data.timeMax) : null;
    if ((timeMin && isNaN(timeMin)) || (timeMax && isNaN(timeMax))) throw new Error("Invalid timeMin/timeMax");
    return { locationId: body.data.locationId, startDate: timeMin || new Date(0), endDate: timeMax || new Date(8640000000000000), slotDurationMinutes, slotStepMinutes };
  }

  // Case D: client might send timeMin/timeMax at top-level
  if (body.timeMin || body.timeMax) {
    const timeMin = body.timeMin ? new Date(body.timeMin) : null;
    const timeMax = body.timeMax ? new Date(body.timeMax) : null;
    if ((timeMin && isNaN(timeMin)) || (timeMax && isNaN(timeMax))) throw new Error("Invalid timeMin/timeMax");
    if (!body.locationId) throw new Error("locationId required with timeMin/timeMax");
    return { locationId: body.locationId, startDate: timeMin || new Date(0), endDate: timeMax || new Date(8640000000000000), slotDurationMinutes, slotStepMinutes };
  }

  throw new Error("locationId and date/time range required");
}

// Utility: check overlap between two intervals [aStart,aEnd) and [bStart,bEnd)
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Generate candidate slots between startDate (inclusive) and endDate (exclusive)
// slotDurationMinutes = duration; slotStepMinutes = step between slot starts
function generateSlots(startDate, endDate, slotDurationMinutes, slotStepMinutes) {
  const slots = [];
  const durationMs = slotDurationMinutes * 60000;
  const stepMs = slotStepMinutes * 60000;
  let cursor = new Date(startDate);

  // Align cursor to minute resolution
  cursor.setSeconds(0, 0);

  while (cursor.getTime() + durationMs <= endDate.getTime()) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor.getTime() + durationMs);
    slots.push({ start: slotStart, end: slotEnd });
    cursor = new Date(cursor.getTime() + stepMs);
  }
  return slots;
}

// Query Firestore for busy events/documents overlapping [startDate, endDate) for a given location
// We'll examine two collections: "bookings" and "disponibilita" (adjust names if needed)
async function fetchBusyEvents(locationId, startDate, endDate) {
  const db = admin.firestore();
  const results = [];

  const startTs = admin.firestore.Timestamp.fromDate(startDate);
  const endTs = admin.firestore.Timestamp.fromDate(endDate);

  // Query bookings: where locationId == X AND start < endDateTs
  // We'll fetch those and client-side filter by end > startDate
  try {
    const bookingsSnap = await db.collection("bookings")
      .where("locationId", "==", locationId)
      .where("start", "<", endTs)
      .get();
    bookingsSnap.forEach(doc => {
      const d = doc.data();
      if (!d.start || !d.end) return;
      const s = d.start.toDate();
      const e = d.end.toDate();
      if (e > startDate && s < endDate) results.push({ start: s, end: e });
    });
  } catch (err) {
    console.warn("Warning: bookings query failed", err.message || err);
  }

  // Query disponibilita: same pattern (collection name used earlier)
  try {
    const dispSnap = await db.collection("disponibilita")
      .where("locationId", "==", locationId)
      .where("date", "<", endTs)
      .get();
    dispSnap.forEach(doc => {
      const d = doc.data();
      // assume disponibilita documents have 'start' and 'end' or single 'date' timestamp
      if (d.start && d.end) {
        const s = d.start.toDate();
        const e = d.end.toDate();
        if (e > startDate && s < endDate) results.push({ start: s, end: e });
      } else if (d.date) {
        // if 'date' is a timestamp representing a single occupied slot moment, treat as a block of default duration (e.g., 30m)
        const s = d.date.toDate();
        const e = new Date(s.getTime() + (d.durationMinutes || 30) * 60000);
        if (e > startDate && s < endDate) results.push({ start: s, end: e });
      }
    });
  } catch (err) {
    console.warn("Warning: disponibilita query failed", err.message || err);
  }

  return results;
}

// Endpoint: calculate free slots
app.post("/getBusySlotsOnBehalfOfAdmin", async (req, res) => {
  try {
    const { locationId, startDate, endDate, slotDurationMinutes, slotStepMinutes } = parseRequestBody(req.body);

    // generate candidate slots
    const candidates = generateSlots(startDate, endDate, slotDurationMinutes, slotStepMinutes);

    // fetch busy events overlapping the window (bookings/disponibilita)
    const busy = await fetchBusyEvents(locationId, startDate, endDate);

    // filter candidates that overlap any busy event
    const freeSlots = candidates.filter(s => {
      for (const b of busy) {
        if (intervalsOverlap(s.start, s.end, b.start, b.end)) return false;
      }
      return true;
    }).map(s => ({
      startISO: s.start.toISOString(),
      endISO: s.end.toISOString()
    }));

    return res.json({ slots: freeSlots });
  } catch (err) {
    console.error("Error in getBusySlotsOnBehalfOfAdmin:", err);
    const msg = err?.message || String(err);
    return res.status(400).json({ error: "bad_request", message: msg });
  }
});

// Helper: OAuth client for Google Calendar (optional)
async function createOAuthClient() {
  const cfg = functions.config().calendar || {};
  const clientId = cfg.client_id;
  const clientSecret = cfg.client_secret;
  const refreshToken = cfg.refresh_token;
  if (!clientId || !clientSecret || !refreshToken) {
    return null; // Calendar not configured
  }
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  return oAuth2Client;
}

// Endpoint: create booking (atomic-ish)
app.post("/createBooking", async (req, res) => {
  try {
    const {
      locationId,
      serviceId = null,
      dateISO,            // ISO start
      durationMinutes = 60,
      clientName,
      clientEmail = null,
      notes = null,
      recaptchaToken = null
    } = req.body || {};

    if (!locationId || !dateISO || !clientName) {
      return res.status(400).json({ error: "missing_fields", message: "locationId, dateISO and clientName are required" });
    }

    const startDate = new Date(dateISO);
    if (isNaN(startDate)) return res.status(400).json({ error: "invalid_date" });
    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

    const db = admin.firestore();

    // Deterministic booking id to avoid duplicates
    const idDate = startDate.toISOString().replace(/[:.]/g, "-");
    const bookingDocId = `${locationId}_${serviceId || "svc"}_${idDate}`;

    const bookingRef = db.collection("bookings").doc(bookingDocId);

    // Transaction: ensure not exists and write booking as pending
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(bookingRef);
      if (snap.exists) throw new Error("SLOT_TAKEN");
      const bookingData = {
        locationId,
        serviceId,
        start: admin.firestore.Timestamp.fromDate(startDate),
        end: admin.firestore.Timestamp.fromDate(endDate),
        clientName,
        clientEmail,
        notes,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      tx.set(bookingRef, bookingData);
    });

    // Try to create calendar event if calendar configured
    const oAuth2Client = await createOAuthClient();
    let calendarEvent = null;
    if (oAuth2Client) {
      const adminEmail = functions.config().calendar?.admin_email || "primary";
      const calendar = google.calendar({ version: "v3", auth: oAuth2Client });
      const event = {
        summary: `${clientName} - Prenotazione ${serviceId || ""}`.trim(),
        description: `Prenotazione via app\nCliente: ${clientName}\nEmail: ${clientEmail || "N/A"}\nNote: ${notes || ""}`,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
        attendees: clientEmail ? [{ email: clientEmail, displayName: clientName }] : [],
        reminders: { useDefault: true }
      };
      try {
        const resp = await calendar.events.insert({
          calendarId: adminEmail,
          requestBody: event
        });
        calendarEvent = resp.data;
      } catch (err) {
        // rollback booking if calendar creation fails
        await db.collection("bookings").doc(bookingDocId).delete().catch(() => {});
        console.error("Calendar insertion failed:", err.message || err);
        return res.status(500).json({ error: "calendar_error", message: String(err?.message || err) });
      }
    }

    // Update booking doc to confirmed
    const updateData = { status: "confirmed", confirmedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (calendarEvent) {
      updateData.calendarEventId = calendarEvent.id || null;
      updateData.calendarHtmlLink = calendarEvent.htmlLink || null;
    }
    await db.collection("bookings").doc(bookingDocId).update(updateData);

    return res.json({
      success: true,
      bookingId: bookingDocId,
      calendarEvent: calendarEvent ? { id: calendarEvent.id, link: calendarEvent.htmlLink } : null
    });
  } catch (err) {
    console.error("createBooking error:", err);
    if (String(err).includes("SLOT_TAKEN")) return res.status(409).json({ error: "slot_taken" });
    return res.status(500).json({ error: "internal", message: String(err?.message || err) });
  }
});

exports.api = (typeof functions.region === "function")
  ? functions.region("us-central1").https.onRequest(app)
  : functions.https.onRequest(app);