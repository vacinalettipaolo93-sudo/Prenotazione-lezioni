// functions/index.js
// Express app for Cloud Functions (exports.api)
// Reads credentials/config from environment variables or SERVICE_ACCOUNT_JSON
// Install dependencies in functions/: npm install express cors firebase-admin firebase-functions googleapis body-parser

const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const { google } = require('googleapis');

const app = express();

// Middlewares
app.use(cors({ origin: true }));
app.use(bodyParser.json());

// Initialize Firebase Admin SDK if possible
function initFirebaseAdmin() {
  if (admin.apps && admin.apps.length > 0) return;
  try {
    // Prefer SERVICE_ACCOUNT_JSON env (stringified JSON)
    if (process.env.SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('Firebase Admin initialized from SERVICE_ACCOUNT_JSON');
      return;
    }
    // Else rely on default credentials (GOOGLE_APPLICATION_CREDENTIALS or runtime)
    admin.initializeApp();
    console.log('Firebase Admin initialized with default credentials');
  } catch (err) {
    console.warn('Could not initialize Firebase Admin:', err.message || err);
  }
}

// Helper: check if service-account / calendar credentials exist
function getCalendarConfig() {
  return {
    clientId: process.env.CALENDAR_CLIENT_ID || null,
    clientSecret: process.env.CALENDAR_CLIENT_SECRET || null,
    redirectUri: process.env.CALENDAR_REDIRECT_URI || null,
    serviceAccountJson: process.env.SERVICE_ACCOUNT_JSON || null,
    refreshToken: process.env.CALENDAR_REFRESH_TOKEN || null,
  };
}

// Utility: create OAuth2 client if clientId/Secret present
function createOAuthClient() {
  const cfg = getCalendarConfig();
  if (!cfg.clientId || !cfg.clientSecret) return null;
  // redirectUri optional — library will accept empty but better to pass if available
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri || undefined);
}

// Route: GET /getGoogleAuthUrl
// Returns { data: { url } } or error JSON
app.get('/getGoogleAuthUrl', async (req, res) => {
  try {
    const oauth2Client = createOAuthClient();
    if (!oauth2Client) {
      return res.status(500).json({ error: 'server_misconfigured', message: 'Missing CALENDAR_CLIENT_ID/CALENDAR_CLIENT_SECRET' });
    }
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      prompt: 'consent',
    });
    return res.json({ data: { url } });
  } catch (err) {
    console.error('getGoogleAuthUrl error:', err);
    return res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
});

// Route: POST /checkServerSetup
// Returns { ok: true, isConfigured: boolean }
app.post('/checkServerSetup', async (req, res) => {
  try {
    const cfg = getCalendarConfig();
    const isConfigured =
      !!(cfg.serviceAccountJson) || // service account JSON present
      (!!cfg.clientId && (!!cfg.refreshToken || !!cfg.clientSecret)); // oauth credentials present
    return res.json({ ok: true, isConfigured });
  } catch (err) {
    console.error('checkServerSetup error:', err);
    return res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
});

/**
 * Endpoint: POST /getBusySlotsOnBehalfOfAdmin
 * Expected body:
 * {
 *   locationId: "GAVARDO",
 *   data: { timeMin: "ISO", timeMax: "ISO" },
 *   slotDurationMinutes: 30,
 *   slotStepMinutes: 30
 * }
 *
 * Response:
 * { slots: [ { startISO, endISO }, ... ] }
 *
 * Implementation notes:
 * - If a service account JSON is provided, uses Google Calendar freebusy to get busy intervals
 * - If not configured, returns an empty array (frontend will fallback)
 */
app.post('/getBusySlotsOnBehalfOfAdmin', async (req, res) => {
  try {
    const { locationId, data, slotDurationMinutes = 30, slotStepMinutes = 30 } = req.body || {};
    if (!data || !data.timeMin || !data.timeMax) {
      return res.status(400).json({ error: 'invalid_request', message: 'data.timeMin and data.timeMax required' });
    }

    const cfg = getCalendarConfig();

    // If service account available, use it to query calendar busy info for configured calendars
    if (cfg.serviceAccountJson) {
      const sa = JSON.parse(cfg.serviceAccountJson);
      const jwtClient = new google.auth.JWT({
        email: sa.client_email,
        key: sa.private_key,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });
      await jwtClient.authorize();

      const calendar = google.calendar({ version: 'v3', auth: jwtClient });

      // Determine calendarIds to check (optionally provided via env SELECTED_CALENDAR_IDS as comma-separated)
      const calendarsEnv = process.env.SELECTED_CALENDAR_IDS || '';
      const calendarIds = calendarsEnv ? calendarsEnv.split(',').map(s => s.trim()).filter(Boolean) : ['primary'];

      const freebusyReq = {
        resource: {
          timeMin: data.timeMin,
          timeMax: data.timeMax,
          items: calendarIds.map(id => ({ id })),
        },
      };

      const fb = await calendar.freebusy.query(freebusyReq);
      const calendars = fb.data.calendars || {};
      // Merge busy intervals across calendars
      const busyIntervals = Object.values(calendars).flatMap(c => (c.busy || []));
      // Convert busy intervals into blocked slots (startISO/endISO) -> return as-is so frontend can decide
      const slots = busyIntervals.map(interval => ({ startISO: interval.start, endISO: interval.end }));
      return res.json({ slots });
    }

    // No calendar configured: return empty array (frontend will fallback to local generation)
    return res.json({ slots: [] });
  } catch (err) {
    console.error('getBusySlotsOnBehalfOfAdmin error:', err);
    return res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
});

/**
 * Endpoint: POST /createBooking
 * Expected body: {
 *   locationId, dateISO, durationMinutes, clientName, clientEmail?, clientPhone?, message?, sport?, lessonType?, targetCalendarId?
 * }
 *
 * Behavior:
 * - Initializes Firebase Admin (if not inited) and writes a document to "bookings"
 * - If calendar configured, attempts to create event on calendar (service account); includes gcalEventId in booking doc if created
 */
app.post('/createBooking', async (req, res) => {
  try {
    const payload = req.body || {};
    const { locationId, dateISO, durationMinutes, clientName } = payload;
    if (!locationId || !dateISO || !durationMinutes || !clientName) {
      return res.status(400).json({ success: false, error: 'invalid_request', message: 'locationId, dateISO, durationMinutes, clientName required' });
    }

    // Initialize admin SDK
    initFirebaseAdmin();
    const db = admin.firestore ? admin.firestore() : null;

    // Attempt to create gCal event if configured (service account)
    let gcalEventId = undefined;
    const cfg = getCalendarConfig();
    if (cfg.serviceAccountJson) {
      try {
        const sa = JSON.parse(cfg.serviceAccountJson);
        const jwtClient = new google.auth.JWT({
          email: sa.client_email,
          key: sa.private_key,
          scopes: ['https://www.googleapis.com/auth/calendar'],
        });
        await jwtClient.authorize();
        const calendar = google.calendar({ version: 'v3', auth: jwtClient });

        // Choose calendarId: targetCalendarId from payload or env-default
        const calendarId = payload.targetCalendarId || process.env.DEFAULT_CALENDAR_ID || 'primary';

        const start = new Date(dateISO);
        const end = new Date(start.getTime() + (durationMinutes * 60 * 1000));

        const eventBody = {
          summary: payload.sport ? `Lezione: ${payload.sport}` : 'Prenotazione',
          description: payload.message || '',
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
        };

        const created = await calendar.events.insert({ calendarId, resource: eventBody });
        gcalEventId = created.data && created.data.id;
      } catch (gErr) {
        console.warn('createBooking: calendar event creation failed:', gErr.message || gErr);
        // continue — still try to save booking to Firestore
      }
    }

    // Save booking to Firestore (if available)
    let bookingId = null;
    if (db) {
      const bookingDoc = {
        ownerUid: payload.ownerUid || null,
        clientName: payload.clientName,
        clientEmail: payload.clientEmail || null,
        clientPhone: payload.clientPhone || null,
        sport: payload.sport || null,
        lessonType: payload.lessonType || null,
        duration: durationMinutes,
        location: payload.locationId,
        startTime: admin.firestore.Timestamp.fromDate(new Date(dateISO)),
        endTime: admin.firestore.Timestamp.fromDate(new Date(new Date(dateISO).getTime() + (durationMinutes * 60 * 1000))),
        status: gcalEventId ? 'confirmed' : 'pending',
        gcalEventId: gcalEventId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      const docRef = await db.collection('bookings').add(bookingDoc);
      bookingId = docRef.id;
    }

    return res.json({ success: true, bookingId, gcalEventId });
  } catch (err) {
    console.error('createBooking error:', err);
    return res.status(500).json({ success: false, error: 'server_error', message: err.message || String(err) });
  }
});

// Health endpoint
app.get('/', (req, res) => res.json({ ok: true, message: 'API is running' }));

// Export the Express app as a single Cloud Function named "api"
exports.api = functions.region('us-central1').https.onRequest(app);
