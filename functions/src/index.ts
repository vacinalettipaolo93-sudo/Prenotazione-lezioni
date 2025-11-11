/**
 * This file serves as the entry point for Firebase Functions.
 * It exports the 'api' function, which is the new Express server implementation,
 * replacing the previous architecture of multiple individual Cloud Functions.
 *
 * All application logic is now contained within 'functions/src/index.ts'.
 */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
// FIX: Change express import to separate default and named imports to resolve typing issues.
import express from "express";
import {
  Request,
  Response,
  NextFunction,
} from "express";
import cors from "cors";
import {google} from "googleapis";
import {DecodedIdToken} from "firebase-admin/auth";

// --- INIZIALIZZAZIONE ---
admin.initializeApp();
const db = admin.firestore();
const app = express();

// --- CONFIGURAZIONE ---
const allowedOrigins = [
  "https://gestionale-prenotazioni-lezioni.vercel.app",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};

app.use(cors(corsOptions));
app.use(express.json());

// NOTE: Using 'any' is a necessary workaround for Firebase's config typing.
const functionsConfig = (functions as any).config();
const GOOGLE_CLIENT_ID = functionsConfig.googleapi?.client_id;
const GOOGLE_CLIENT_SECRET = functionsConfig.googleapi?.client_secret;
const GOOGLE_REDIRECT_URI = functionsConfig.googleapi?.redirect_uri;
const ADMIN_UID = functionsConfig.admin?.uid;

const oAuth2Client = GOOGLE_CLIENT_ID ? new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
) : null;

// --- MIDDLEWARE ---

// FIX: Use `Request`, `Response`, `NextFunction` types from `express`.
const authenticateAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const {authorization} = req.headers;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    const message = "Unauthorized: No token provided.";
    return res.status(401).send({error: {message}});
  }

  const split = authorization.split("Bearer ");
  if (split.length !== 2) {
    const message = "Unauthorized: Malformed token.";
    return res.status(401).send({error: {message}});
  }

  const token = split[1];
  try {
    const decodedToken: DecodedIdToken =
      await admin.auth().verifyIdToken(token);
    res.locals.user = decodedToken;
    return next();
  } catch (err) {
    console.error("Error while verifying Firebase ID token:", err);
    const message = "Unauthorized: Invalid token.";
    return res.status(403).send({error: {message}});
  }
};

// FIX: Use `Request`, `Response`, `NextFunction` types from `express`.
const checkServerConfig = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!oAuth2Client || !ADMIN_UID) {
    console.error(
      "CRITICAL ERROR: Google API config or Admin UID is not set. " +
      "Run `firebase functions:config:set`.",
    );
    const message = "Server is not configured for Google requests.";
    return res.status(503).json({error: {message}});
  }
  return next();
};


// --- HELPERS ---

const getAdminSettingsRef = (uid: string) => db.collection("settings").doc(uid);

const setGoogleAuthCredentials = async (adminUid: string) => {
  if (!oAuth2Client) {
    return false;
  }
  const settingsDoc = await getAdminSettingsRef(adminUid).get();
  const settings = settingsDoc.data();
  if (settings && settings.googleRefreshToken) {
    oAuth2Client.setCredentials({
      refresh_token: settings.googleRefreshToken,
    });
    return true;
  }
  return false;
};

// --- ENDPOINTS ---
app.use(checkServerConfig);

app.post(
  "/getAuthURL",
  authenticateAdmin,
  // FIX: Use `Request`, `Response` types from `express`.
  (req: Request, res: Response) => {
    if (!oAuth2Client) { // Redundant check to satisfy linter
      const message = "Server not configured.";
      return res.status(503).json({error: {message}});
    }
    const adminUid = res.locals.user.uid;
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar"],
      state: adminUid,
    });
    res.json({data: {url: authUrl}});
  },
);

// FIX: Use `Request`, `Response` types from `express`.
app.get("/oauthcallback", async (req: Request, res: Response) => {
  if (!oAuth2Client) { // Redundant check to satisfy linter
    const message = "Server not configured.";
    return res.status(503).json({error: {message}});
  }
  const {code, state} = req.query;
  const adminUid = state as string;

  if (!code) {
    return res.status(400).send("Error: Missing authorization code.");
  }
  if (!adminUid) {
    return res.status(400).send("Error: Missing admin UID in state.");
  }

  try {
    const {tokens} = await oAuth2Client.getToken(code as string);
    const {
      refresh_token: refreshToken,
      access_token: accessToken,
    } = tokens;

    if (!refreshToken) {
      throw new Error("Refresh token not received. Please re-authorize.");
    }

    oAuth2Client.setCredentials({access_token: accessToken});
    const people = google.people({version: "v1", auth: oAuth2Client});
    const profile = await people.people.get({
      resourceName: "people/me",
      personFields: "emailAddresses",
    });
    const email = profile.data.emailAddresses?.[0]?.value || null;

    await getAdminSettingsRef(adminUid).set({
      googleRefreshToken: refreshToken,
      googleAccountEmail: email,
    }, {merge: true});

    return res.send("<script>window.close();</script>");
  } catch (error) {
    const err = error as Error;
    console.error("Error during OAuth code exchange:", err);
    const msg = `Google authentication error: ${err.message}`;
    return res.status(500).send(msg);
  }
});

app.post(
  "/checkTokenStatus",
  authenticateAdmin,
  // FIX: Use `Request`, `Response` types from `express`.
  async (req: Request, res: Response) => {
    try {
      const settingsDoc = await getAdminSettingsRef(res.locals.user.uid).get();
      const settings = settingsDoc.data();
      if (settings?.googleRefreshToken && settings?.googleAccountEmail) {
        return res.json({
          data: {isConnected: true, email: settings.googleAccountEmail},
        });
      } else {
        return res.json({data: {isConnected: false, email: null}});
      }
    } catch (error) {
      console.error("Error checking token status:", error);
      const message = "Internal server error.";
      return res.status(500).json({error: {message}});
    }
  },
);

app.post(
  "/disconnectGoogleAccount",
  authenticateAdmin,
  // FIX: Use `Request`, `Response` types from `express`.
  async (req: Request, res: Response) => {
    try {
      await getAdminSettingsRef(res.locals.user.uid).update({
        googleRefreshToken: admin.firestore.FieldValue.delete(),
        googleAccountEmail: admin.firestore.FieldValue.delete(),
      });
      return res.json({data: {success: true}});
    } catch (error) {
      console.error("Error during disconnect:", error);
      const message = "Internal server error.";
      return res.status(500).json({error: {message}});
    }
  },
);

app.post(
  "/listGoogleCalendars",
  authenticateAdmin,
  // FIX: Use `Request`, `Response` types from `express`.
  async (req: Request, res: Response) => {
    try {
      const hasCreds = await setGoogleAuthCredentials(res.locals.user.uid);
      if (!hasCreds) {
        const message = "Google account not connected.";
        return res.status(400).json({error: {message}});
      }
      const calendar = google.calendar({version: "v3", auth: oAuth2Client});
      const calendarList = await calendar.calendarList.list();
      return res.json({data: calendarList.data.items});
    } catch (error) {
      console.error("Error listing calendars:", error);
      const message = "Could not retrieve calendar list.";
      return res.status(500).json({error: {message}});
    }
  },
);

// --- ENDPOINTS PUBBLICI ---

app.post(
  "/getBusySlotsOnBehalfOfAdmin",
  // FIX: Use `Request`, `Response` types from `express`.
  async (req: Request, res: Response) => {
    const {timeMin, timeMax, calendarIds} = req.body.data;

    if (!ADMIN_UID) {
      const message = "Admin UID not configured on server.";
      return res.status(500).json({error: {message}});
    }

    try {
      const hasCreds = await setGoogleAuthCredentials(ADMIN_UID);
      if (!hasCreds) {
        return res.json({data: []});
      }

      const calendar = google.calendar({version: "v3", auth: oAuth2Client});
      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          items: calendarIds.map((id: string) => ({id})),
        },
      });

      const busyIntervals: {start: string, end: string}[] = [];
      const calendarsData = response.data.calendars || {};
      for (const calId in calendarsData) {
        if (Object.prototype.hasOwnProperty.call(calendarsData, calId)) {
          calendarsData[calId].busy?.forEach((interval) => {
            if (interval.start && interval.end) {
              busyIntervals.push({start: interval.start, end: interval.end});
            }
          });
        }
      }
      return res.json({data: busyIntervals});
    } catch (error) {
      console.error("Error fetching busy slots:", error);
      const message = "Could not retrieve availability.";
      return res.status(500).json({error: {message}});
    }
  },
);

app.post(
  "/createEventOnBehalfOfAdmin",
  // FIX: Use `Request`, `Response` types from `express`.
  async (req: Request, res: Response) => {
    const eventData = req.body.data;
    if (!ADMIN_UID) {
      const message = "Admin UID not configured on server.";
      return res.status(500).json({error: {message}});
    }

    try {
      const hasCreds = await setGoogleAuthCredentials(ADMIN_UID);
      if (!hasCreds) {
        const message = "Admin's Google account is not connected.";
        return res.status(400).json({error: {message}});
      }

      const calendar = google.calendar({version: "v3", auth: oAuth2Client});
      const description = "Dettagli Prenotazione:\n\n" +
        `Cliente: ${eventData.clientName}\n` +
        `Email: ${eventData.clientEmail}\n` +
        `Telefono: ${eventData.clientPhone}\n\n` +
        `Tipo Lezione: ${eventData.lessonType}\n` +
        `Durata: ${eventData.duration} min\n` +
        `Note: ${eventData.message || "Nessuna"}`;

      const event = {
        summary: `Lezione: ${eventData.sport} - ${eventData.clientName}`,
        location: eventData.location,
        description,
        start: {dateTime: eventData.startTime, timeZone: "Europe/Rome"},
        end: {dateTime: eventData.endTime, timeZone: "Europe/Rome"},
        attendees: [{email: eventData.clientEmail}],
        reminders: {
          useDefault: false,
          overrides: [
            {method: "email", minutes: 24 * 60},
            {method: "popup", minutes: 60},
          ],
        },
      };

      const createdEvent = await calendar.events.insert({
        calendarId: eventData.targetCalendarId || "primary",
        requestBody: event,
        sendUpdates: "all",
      });

      return res.json({
        data: {eventCreated: true, eventId: createdEvent.data.id},
      });
    } catch (error) {
      console.error("Error creating event:", error);
      const message = "Could not create calendar event.";
      return res.status(500).json({error: {message}});
    }
  },
);


export const api = functions.https.onRequest(app);
