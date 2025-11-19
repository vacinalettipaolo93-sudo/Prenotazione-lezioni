// functions/index.js
// Defensive Express app for Cloud Functions (exports.api)
// Registers handlers both on /X and /api/X to avoid double-prefix issues.
// Install deps in functions/: npm install express cors body-parser firebase-admin firebase-functions googleapis

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
app.use(bodyParser.urlencoded({ extended: true }));

// Initialize Firebase Admin (defensive)
function initFirebaseAdmin() {
  if (admin.apps && admin.apps.length > 0) return;
  try {
    if (process.env.SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log('Firebase Admin initialized from SERVICE_ACCOUNT_JSON');
      return;
    }
    admin.initializeApp();
    console.log('Firebase Admin initialized with default credentials');
  } catch (err) {
    console.warn('Could not initialize Firebase Admin:', err.message || err);
  }
}

function getCalendarConfig() {
  return {
    clientId: process.env.CALENDAR_CLIENT_ID || null,
    clientSecret: process.env.CALENDAR_CLIENT_SECRET || null,
    redirectUri: process.env.CALENDAR_REDIRECT_URI || null,
    serviceAccountJson: process.env.SERVICE_ACCOUNT_JSON || null,
    refreshToken: process.env.CALENDAR_REFRESH_TOKEN || null,
  };
}

function createOAuthClient() {
  const cfg = getCalendarConfig();
  if (!cfg.clientId || !cfg.clientSecret) return null;
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri || undefined);
}

// Helper to register same handler on both /path and /api/path
function registerBoth(method, path, handler) {
  if (method === 'get') {
    app.get(path, handler);
    app.get('/api' + path, handler);
  } else if (method === 'post') {
    app.post(path, handler);
    app.post('/api' + path, handler);
  } else {
    app.use(path, handler);
    app.use('/api' + path, handler);
  }
}

// Handler: getGoogleAuthUrl (supports GET and POST)
const handleGetGoogleAuthUrl = async (req, res) => {
  try {
    const oauth2Client = createOAuthClient();
    if (!oauth2Client) {
      return res.status(500).json({ error: 'server_misconfigured', message: 'Missing CALENDAR_CLIENT_ID and/or CALENDAR_CLIENT_SECRET' });
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
};
registerBoth('get', '/getGoogleAuthUrl', handleGetGoogleAuthUrl);
registerBoth('post', '/getGoogleAuthUrl', handleGetGoogleAuthUrl);

// Handler: checkServerSetup (supports GET and POST)
const handleCheckServerSetup = async (req, res) => {
  try {
    const cfg = getCalendarConfig();
    const isConfigured =
      !!(cfg.serviceAccountJson) ||
      (!!cfg.clientId && (!!cfg.refreshToken || !!cfg.clientSecret));
    return res.json({ ok: true, isConfigured });
  } catch (err) {
    console.error('checkServerSetup error:', err);
    return res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
};
registerBoth('get', '/checkServerSetup', handleCheckServerSetup);
registerBoth('post', '/checkServerSetup', handleCheckServerSetup);

/**
 * POST /getBusySlotsOnBehalfOfAdmin
 * Expects { locationId, data: { timeMin, timeMax }, slotDurationMinutes, slotStepMinutes }
 */
registerBoth('post', '/getBusySlotsOnBehalfOfAdmin', async (req, res) => {
  try {
    const { locationId, data, slotDurationMinutes = 30 } = req.body || {};
    if (!data || !data.timeMin || !data.timeMax) {
      return res.status(400).json({ error: 'invalid_request', message: 'data.timeMin and data.timeMax required' });
    }

    const cfg = getCalendarConfig();
    if (cfg.serviceAccountJson) {
      const sa = JSON.parse(cfg.serviceAccountJson);
      const jwtClient = new google.auth.JWT({
        email: sa.client_email,
        key: sa.private_key,
        scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      });
      await jwtClient.authorize();
      const calendar = google.calendar({ version: 'v3', auth: jwtClient });

      const calendarsEnv = process.env.SELECTED_CALENDAR_IDS || '';
      const calendarIds = calendarsEnv ? calendarsEnv.split(',').map(s => s.trim()).filter(Boolean) : ['primary'];

      const fbReq = {
        resource: {
          timeMin: data.timeMin,
          timeMax: data.timeMax,
          items: calendarIds.map(id => ({ id })),
        },
      };

      const fb = await calendar.freebusy.query(fbReq);
      const calMap = fb.data.calendars || {};
      const busyIntervals = Object.values(calMap).flatMap(c => (c.busy || []));
      const slots = busyIntervals.map(interval => ({ startISO: interval.start, endISO: interval.end }));
      return res.json({ slots });
    }

    return res.json({ slots: [] });
  } catch (err) {
    console.error('getBusySlotsOnBehalfOfAdmin error:', err);
    return res.status(500).json({ error: 'server_error', message: err.message || String(err) });
  }
});

/**
 * POST /createBooking
 */
registerBoth('post', '/createBooking', async (req, res) => {
  try {
    const payload = req.body || {};
    const { locationId, dateISO, durationMinutes, clientName } = payload;
    if (!locationId || !dateISO || !durationMinutes || !clientName) {
      return res.status(400).json({ success: false, error: 'invalid_request', message: 'locationId, dateISO, durationMinutes, clientName required' });
    }

    initFirebaseAdmin();
    const db = admin.firestore ? admin.firestore() : null;

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
      }
    }

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

// Health endpoints (both prefixes)
app.get('/', (req, res) => res.json({ ok: true, message: 'API is running' }));
app.get('/api', (req, res) => res.json({ ok: true, message: 'API is running (api prefix)' }));

// Export the Express app as Cloud Function "api"
exports.api = functions.region('us-central1').https.onRequest(app);

// OPTIONAL: log registered routes on startup (for debugging when emulator starts)
if (app && app._router && app._router.stack) {
  const routes = app._router.stack
    .filter(r => r.route && r.route.path)
    .map(r => {
      const methods = r.route.methods ? Object.keys(r.route.methods).join(',') : '';
      return `${r.route.path} [${methods}]`;
    });
  console.log('Registered routes:', routes);
}
