/**
 * functions/src/index.ts
 *
 * OAuth + helper endpoints for Google Calendar integration.
 *
 * Routes added/kept:
 *  - GET  /getGoogleAuthUrl            (requires Firebase ID token) -> { data: { url, state } }
 *  - GET  /auth/google/callback        (called by Google, uses state -> adminUid mapping)
 *  - POST /listGoogleCalendars         (requires Firebase ID token)
 *  - POST /checkServerConfiguration    (open)
 *  - POST /checkServerSetup            (alias for backward compatibility)
 *  - POST /getConnectionStatus         (requires Firebase ID token)  <-- NEW (frontend expects this)
 *
 * Notes:
 * - Supports functions.config().google.* and functions.config().googleapi.* keys for backward compatibility.
 * - State mapping saved to collection 'oauth_states' and consumed by callback.
 * - Tokens saved to collection 'integrations' under id `google_<adminUid>`.
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { google } from "googleapis";
import crypto from "crypto";

admin.initializeApp();
const db = admin.firestore();
const app = express();

const allowedOrigins = [
  "https://gestionale-prenotazioni-lezioni.vercel.app",
  "https://gestionale-prenotazioni-lezio.web.app",
  "https://gestionale-prenotazioni-lezio.firebaseapp.com",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
}));

app.use(express.json());

// Config / helpers
const cfg = functions.config() as any;

// Backwards-compatible reading of config keys:
const SERVICE_ACCOUNT_KEY_JSON = cfg.googleapi?.service_account_key || cfg.google?.service_account_key || null;
const OAUTH_CLIENT_ID = cfg.google?.oauth_client_id || cfg.googleapi?.client_id || cfg.googleapi?.client_id || cfg.google?.client_id || "";
const OAUTH_CLIENT_SECRET = cfg.google?.oauth_client_secret || cfg.googleapi?.client_secret || cfg.google?.client_secret || cfg.googleapi?.client_secret || "";
const PROJECT_ID = process.env.GCP_PROJECT || cfg?.project?.projectId || (cfg.googleapi && cfg.googleapi.project_id) || "";

const OAUTH_REDIRECT = `https://us-central1-${PROJECT_ID}.cloudfunctions.net/api/auth/google/callback`;

// TTL for state entries (ms)
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Middleware to verify Firebase ID token (used for endpoints initiated by the frontend)
const verifyFirebaseTokenMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = (req.headers.authorization || "") as string;
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: { message: "Missing token" } });
      return;
    }
    const idToken = authHeader.split("Bearer ")[1];
    if (!idToken) {
      res.status(401).json({ error: { message: "Malformed token" } });
      return;
    }
    const decoded = await admin.auth().verifyIdToken(idToken);
    (req as any).authUser = decoded;
    next();
    return;
  } catch (err) {
    console.error("verify token error", err);
    res.status(401).json({ error: { message: "Unauthorized" } });
    return;
  }
};

const getOAuth2Client = (redirect?: string) => {
  const redirectUri = redirect || OAUTH_REDIRECT;
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) return null;
  return new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, redirectUri);
};

const saveGoogleTokensForAdmin = async (adminUid: string, tokens: any) => {
  await db.collection("integrations").doc(`google_${adminUid}`).set({
    tokens,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    owner: adminUid,
  }, { merge: true });
};

const getStoredGoogleTokens = async (adminUid: string) => {
  const doc = await db.collection("integrations").doc(`google_${adminUid}`).get();
  if (!doc.exists) return null;
  return doc.data()?.tokens || null;
};

const getAuthClientFromStored = async (adminUid: string) => {
  const tokens = await getStoredGoogleTokens(adminUid);
  if (!tokens) return null;
  const client = getOAuth2Client();
  if (!client) return null;
  client.setCredentials(tokens);
  return client;
};

// Create a random state token
const generateState = (): string => {
  return crypto.randomBytes(20).toString("hex");
};

// Save state -> adminUid mapping in Firestore (short lived)
const saveStateMapping = async (state: string, adminUid: string) => {
  const docRef = db.collection("oauth_states").doc(state);
  await docRef.set({
    adminUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

// Get and delete state mapping atomically, and check TTL
const consumeStateMapping = async (state: string) => {
  const docRef = db.collection("oauth_states").doc(state);
  const snap = await docRef.get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  if (data?.createdAt && typeof data.createdAt.toMillis === "function") {
    const createdMs = data.createdAt.toMillis();
    const nowMs = Date.now();
    if (nowMs - createdMs > STATE_TTL_MS) {
      // expired
      await docRef.delete().catch(() => {});
      return null;
    }
  }
  await docRef.delete().catch(() => {});
  return data;
};

// ---------- ROUTES ---------- //

// GET /getGoogleAuthUrl -> returns { data: { url, state } }
// Requires Firebase ID token
app.get("/getGoogleAuthUrl", verifyFirebaseTokenMiddleware, async (req: Request, res: Response) => {
  try {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) return res.status(500).json({ error: { message: "OAuth client not configured on server." } });
    const scope = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'];

    const adminUid = (req as any).authUser?.uid;
    if (!adminUid) return res.status(401).json({ error: { message: "Unauthorized: admin uid missing" } });

    const state = generateState();
    await saveStateMapping(state, adminUid);

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope,
      prompt: 'consent',
      state,
    });
    return res.json({ data: { url, state } });
  } catch (err) {
    console.error("getGoogleAuthUrl error", err);
    return res.status(500).json({ error: { message: "Failed to generate url" }});
  }
});

// GET /auth/google/callback?code=...&state=...
// Called by Google (no Authorization header required)
app.get("/auth/google/callback", async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    if (!code || !state) {
      res.status(400).send("Missing code or state");
      return;
    }
    const mapping = await consumeStateMapping(state);
    if (!mapping) {
      res.status(400).send("Invalid or expired state");
      return;
    }
    const adminUid = mapping.adminUid as string;
    if (!adminUid) {
      res.status(400).send("Invalid state mapping");
      return;
    }
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) {
      res.status(500).send("OAuth client not configured");
      return;
    }
    const r = await oauth2Client.getToken(code);
    const tokens = r.tokens;
    if (!tokens) {
      res.status(500).send("Failed to obtain tokens");
      return;
    }
    await saveGoogleTokensForAdmin(adminUid, tokens);
    const frontendUrl = "https://gestionale-prenotazioni-lezioni.vercel.app/integrations?google_connected=1";
    return res.redirect(frontendUrl);
  } catch (err) {
    console.error("auth callback error", err);
    return res.status(500).send("Error exchanging code for tokens");
  }
});

// POST /listGoogleCalendars -> returns calendar list (requires Firebase ID token)
app.post("/listGoogleCalendars", verifyFirebaseTokenMiddleware, async (req: Request, res: Response) => {
  try {
    const adminUid = (req as any).authUser?.uid || null;
    if (!adminUid) return res.status(401).json({ error: { message: "Unauthorized" } });

    let calendarClient;
    const authClient = await getAuthClientFromStored(adminUid);
    if (authClient) {
      calendarClient = google.calendar({ version: "v3", auth: authClient });
    } else if (SERVICE_ACCOUNT_KEY_JSON) {
      const creds = typeof SERVICE_ACCOUNT_KEY_JSON === "string" ? JSON.parse(SERVICE_ACCOUNT_KEY_JSON) : SERVICE_ACCOUNT_KEY_JSON;
      const jwt = new google.auth.JWT(creds.client_email, undefined, creds.private_key, ['https://www.googleapis.com/auth/calendar']);
      calendarClient = google.calendar({ version: "v3", auth: jwt });
    } else {
      return res.status(503).json({ error: { message: "No Google auth available" } });
    }
    const list = await calendarClient.calendarList.list();
    return res.json({ data: list.data.items || [] });
  } catch (err) {
    console.error("listGoogleCalendars err", err);
    return res.status(500).json({ error: { message: "Could not list calendars" } });
  }
});

// POST /checkServerConfiguration -> { isConfigured: boolean, serviceAccountEmail?: string }
app.post("/checkServerConfiguration", async (req: Request, res: Response) => {
  try {
    if (SERVICE_ACCOUNT_KEY_JSON) {
      const creds = typeof SERVICE_ACCOUNT_KEY_JSON === "string" ? JSON.parse(SERVICE_ACCOUNT_KEY_JSON) : SERVICE_ACCOUNT_KEY_JSON;
      return res.json({ data: { isConfigured: true, serviceAccountEmail: creds.client_email }});
    }
    return res.json({ data: { isConfigured: false, serviceAccountEmail: null }});
  } catch (err) {
    console.error("checkServerConfiguration error", err);
    return res.json({ data: { isConfigured: false }});
  }
});

// ALIAS for older frontend: POST /checkServerSetup
app.post("/checkServerSetup", async (req: Request, res: Response) => {
  try {
    if (SERVICE_ACCOUNT_KEY_JSON) {
      const creds = typeof SERVICE_ACCOUNT_KEY_JSON === "string" ? JSON.parse(SERVICE_ACCOUNT_KEY_JSON) : SERVICE_ACCOUNT_KEY_JSON;
      return res.json({ data: { isConfigured: true, serviceAccountEmail: creds.client_email }});
    }
    return res.json({ data: { isConfigured: false, serviceAccountEmail: null }});
  } catch (err) {
    console.error("checkServerSetup error", err);
    return res.json({ data: { isConfigured: false }});
  }
});

// NEW: POST /getConnectionStatus -> returns { isConnected, serviceAccountEmail, calendars? }
// Requires Firebase ID token
app.post("/getConnectionStatus", verifyFirebaseTokenMiddleware, async (req: Request, res: Response) => {
  try {
    const adminUid = (req as any).authUser?.uid;
    if (!adminUid) return res.status(401).json({ error: { message: "Unauthorized" } });

    let isConnected = false;
    let serviceAccountEmail: string | null = null;
    let calendars: any[] = [];

    // If service account present, treat as connected and try to list calendars
    if (SERVICE_ACCOUNT_KEY_JSON) {
      isConnected = true;
      const creds = typeof SERVICE_ACCOUNT_KEY_JSON === "string" ? JSON.parse(SERVICE_ACCOUNT_KEY_JSON) : SERVICE_ACCOUNT_KEY_JSON;
      serviceAccountEmail = creds.client_email;
      try {
        const jwt = new google.auth.JWT(creds.client_email, undefined, creds.private_key, ['https://www.googleapis.com/auth/calendar']);
        const calendar = google.calendar({ version: "v3", auth: jwt });
        const list = await calendar.calendarList.list();
        calendars = list.data.items || [];
      } catch (err) {
        console.error("list with service account failed", err);
        // keep isConnected true but no calendars
      }
      return res.json({ data: { isConnected, serviceAccountEmail, calendars }});
    }

    // Otherwise check for stored user tokens
    const tokens = await getStoredGoogleTokens(adminUid);
    if (tokens) {
      isConnected = true;
      try {
        const client = getOAuth2Client();
        if (client) {
          client.setCredentials(tokens);
          const calendar = google.calendar({ version: "v3", auth: client });
          const list = await calendar.calendarList.list();
          calendars = list.data.items || [];
        }
      } catch (err) {
        console.error("list with user tokens failed", err);
      }
    }

    return res.json({ data: { isConnected, serviceAccountEmail, calendars }});
  } catch (err) {
    console.error("getConnectionStatus error", err);
    return res.status(500).json({ error: { message: "Could not determine connection status" }});
  }
});

// Export
export const api = functions.region("us-central1").runWith({ memory: "512MB", timeoutSeconds: 60 }).https.onRequest(app);
export { checkSlotFree, createBooking } from './bookings';
