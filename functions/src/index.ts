/**
 * functions/src/index.ts
 * - Endpoints:
 *   GET  /getGoogleAuthUrl          -> returns { data: { url } } (requires Firebase ID token)
 *   GET  /auth/google/callback      -> exchanges code for tokens, saves tokens in Firestore for admin user, redirects to frontend
 *   POST /listGoogleCalendars       -> lists calendars (uses stored oauth or service account fallback)
 *   POST /checkServerConfiguration  -> returns whether service account key exists
 *
 * Required config (set with firebase functions:config:set):
 *   google.oauth_client_id
 *   google.oauth_client_secret
 * Optionally existing: googleapi.service_account_key (stringified JSON)
 *
 * Redirect URI to register in Google Cloud Console:
 *   https://us-central1-<PROJECT_ID>.cloudfunctions.net/api/auth/google/callback
 */

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { google } from "googleapis";

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
    // allow undefined origin (server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
}));

app.use(express.json());

// Helpers
const functionsConfig = functions.config() as any;
const SERVICE_ACCOUNT_KEY_JSON = functionsConfig.googleapi?.service_account_key || null;
const OAUTH_CLIENT_ID = functionsConfig.google?.oauth_client_id || "";
const OAUTH_CLIENT_SECRET = functionsConfig.google?.oauth_client_secret || "";
const PROJECT_ID = process.env.GCP_PROJECT || functionsConfig?.project?.projectId || "";

const OAUTH_REDIRECT = `https://us-central1-${PROJECT_ID}.cloudfunctions.net/api/auth/google/callback`;

const verifyFirebaseTokenMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return res.status(401).json({ error: { message: "Missing token" } });
    const idToken = authHeader.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    (req as any).authUser = decoded;
    next();
  } catch (err) {
    console.error("verify token error", err);
    return res.status(401).json({ error: { message: "Unauthorized" } });
  }
};

const getOAuth2Client = () => {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) return null;
  return new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT);
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

// Routes

// GET /getGoogleAuthUrl  -> returns { data: { url } }
app.get("/getGoogleAuthUrl", verifyFirebaseTokenMiddleware, async (req: Request, res: Response) => {
  try {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) return res.status(500).json({ error: { message: "OAuth client not configured on server." } });
    const scope = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'];
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope,
      prompt: 'consent'
    });
    return res.json({ data: { url } });
  } catch (err) {
    console.error("getGoogleAuthUrl error", err);
    return res.status(500).json({ error: { message: "Failed to generate url" }});
  }
});

// GET /auth/google/callback?code=...
// Note: we still require the admin to be authenticated (we rely on the frontend to include Authorization).
app.get("/auth/google/callback", verifyFirebaseTokenMiddleware, async (req: Request, res: Response) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");
  try {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) return res.status(500).send("OAuth client not configured");
    const resp = await oauth2Client.getToken(code.toString());
    const tokens = resp.tokens;
    const adminUid = (req as any).authUser?.uid || "admin";
    await saveGoogleTokensForAdmin(adminUid, tokens);
    // Redirect back to the frontend integrations page (with query param)
    const frontendUrl = "https://gestionale-prenotazioni-lezioni.vercel.app/integrations?google_connected=1";
    return res.redirect(frontendUrl);
  } catch (err) {
    console.error("Callback error", err);
    return res.status(500).send("Error exchanging code for tokens");
  }
});

// POST /listGoogleCalendars -> returns calendar list of stored account or service account
app.post("/listGoogleCalendars", verifyFirebaseTokenMiddleware, async (req: Request, res: Response) => {
  try {
    const adminUid = (req as any).authUser?.uid || "admin";
    let calendarClient;
    const authClient = await getAuthClientFromStored(adminUid);
    if (authClient) {
      calendarClient = google.calendar({ version: "v3", auth: authClient });
    } else if (SERVICE_ACCOUNT_KEY_JSON) {
      const creds = JSON.parse(SERVICE_ACCOUNT_KEY_JSON);
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
      const creds = JSON.parse(SERVICE_ACCOUNT_KEY_JSON);
      return res.json({ data: { isConfigured: true, serviceAccountEmail: creds.client_email }});
    }
    return res.json({ data: { isConfigured: false, serviceAccountEmail: null }});
  } catch (err) {
    return res.json({ data: { isConfigured: false }});
  }
});

// Export the api function
export const api = functions.region("us-central1").runWith({ memory: "512MB", timeoutSeconds: 60 }).https.onRequest(app);
