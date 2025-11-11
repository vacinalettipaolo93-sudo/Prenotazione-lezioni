// Questo file deve essere collocato nella cartella 'functions/src' del
// tuo progetto Firebase. Assicurati di aver installato le dipendenze
// necessarie con `npm install`.

// FIX: Changed import to namespace import to resolve type inference issues with `config` and `https`.
// FIX: Switched from namespace import to direct imports for `https` and `config` to resolve 'never' type errors.
import { https, config } from "firebase-functions/v1";
import * as admin from "firebase-admin";
import {google} from "googleapis";
// FIX: Removed aliasing for Request and Response to fix type compatibility issues with Express handlers.
// FIX: Using fully qualified express types to avoid conflicts with other 'Request'/'Response' types.
import express from "express";
import cors from "cors";

// ** GESTIONE ROBUSTA DEGLI ERRORI DI INIZIALIZZAZIONE **
let db: admin.firestore.Firestore;
try {
  admin.initializeApp();
  db = admin.firestore();
} catch (e: unknown) {
  const errorMessage = e instanceof Error ? e.message : String(e);
  console.error(
    "ERRORE CRITICO DI INIZIALIZZAZIONE FIREBASE:",
    errorMessage,
  );
}

const app = express();

app.use(cors({origin: true}));

// Interfaccia personalizzata per le richieste autenticate
// FIX: Extended from `Request` directly.
// FIX: Extended from `express.Request` to ensure correct type.
interface AuthenticatedRequest extends express.Request {
  user?: admin.auth.DecodedIdToken;
}

// ** FUNZIONI HELPER CON GESTIONE ERRORI INTEGRATA **

const getOauth2Client = () => {
  /* eslint-disable camelcase */
  // FIX: Used namespace import `functions.config()`.
  // FIX: Changed to use imported `config` function.
  const functionsConfig = config();
  const client_id = functionsConfig.googleapi?.client_id;
  const client_secret = functionsConfig.googleapi?.client_secret;
  const redirect_uri = functionsConfig.googleapi?.redirect_uri;

  if (!client_id || !client_secret || !redirect_uri) {
    const msg = "Una o più variabili d'ambiente Google API non sono impostate";
    console.error(msg +
        ". Esegui `firebase functions:config:set googleapi.client_id=...`");
    throw new Error("Configurazione del server incompleta.");
  }

  return new google.auth.OAuth2(client_id, client_secret, redirect_uri);
  /* eslint-enable camelcase */
};

const getAdminUid = () => {
  // FIX: Used namespace import `functions.config()`.
  // FIX: Changed to use imported `config` function.
  const adminUid = config().admin?.uid;
  if (!adminUid) {
    const msg = "La variabile d'ambiente ADMIN_UID non è stata impostata." +
    " Esegui `firebase functions:config:set admin.uid=...`";
    console.error(msg);
    throw new Error("Configurazione del server incompleta.");
  }
  return adminUid;
};

// ** MIDDLEWARE DI AUTENTICAZIONE BLINDATO **
const adminAuthMiddleware = async (
    req: AuthenticatedRequest,
    // FIX: Used `Response` type directly.
    // FIX: Using fully qualified `express.Response` and `express.NextFunction` types.
    res: express.Response,
    next: express.NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      const err = "Unauthorized: Token mancante o malformato.";
      return res.status(403).json({error: {message: err}});
    }
    const adminUid = getAdminUid();
    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    if (decodedToken.uid !== adminUid) {
      const err = "Permesso negato: l'utente non è un amministratore.";
      return res.status(403).json({error: {message: err}});
    }
    req.user = decodedToken;
    return next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Errore di autenticazione nel middleware:", errorMessage);
    const message = `Non autorizzato: ${errorMessage}`;
    return res.status(403).json({
      error: {message},
    });
  }
};

// ** WRAPPER PER GLI ENDPOINT **
const handleApiRequest = (
    handler: (
      req: AuthenticatedRequest,
      // FIX: Used `Response` type directly.
      // FIX: Using fully qualified `express.Response` type.
      res: express.Response
    ) => Promise<void>,
) => {
  // FIX: Used `Response` type directly.
  // FIX: Using fully qualified `express.Response` type.
  return async (req: AuthenticatedRequest, res: express.Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      const path = `[${req.path}]`;
      const errorMessage = error instanceof Error ?
        error.message :
        "Errore interno del server.";
      console.error(`ERRORE NON GESTITO NELL'ENDPOINT ${path}:`, error);
      res.status(500).json({
        error: {message: errorMessage},
      });
    }
  };
};

// =================================================================================
// DEFINIZIONE DEGLI ENDPOINT
// =================================================================================

app.post(
    "/getAuthURL",
    adminAuthMiddleware,
    handleApiRequest(async (req, res) => {
      const oauth2Client = getOauth2Client();
      const scopes = ["https://www.googleapis.com/auth/calendar"];
      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: scopes,
      });
      res.json({data: {url}});
    }),
);

app.get(
    "/oauthcallback",
    handleApiRequest(async (req, res) => {
      const oauth2Client = getOauth2Client();
      const code = req.query.code as string;
      if (!code) {
        throw new Error("Codice autorizzazione non presente.");
      }

      const {tokens} = await oauth2Client.getToken(code);
      if (tokens && tokens.refresh_token) {
        const tokenDocRef = db.collection("googleTokens").doc(getAdminUid());
        await tokenDocRef.set({refresh_token: tokens.refresh_token});
      }
      const htmlResponse = `
        <html>
          <body style="font-family: sans-serif; text-align: center;
            background-color: #1a202c; color: #e2e8f0; display: flex;
            justify-content: center; align-items: center; height: 100vh;">
            <div>
              <h1 style="color: #48bb78;">Autorizzazione completata!</h1>
              <p>Questa finestra si chiuderà a breve.</p>
              <script>setTimeout(() => window.close(), 2000);</script>
            </div>
          </body>
        </html>`;
      res.send(htmlResponse);
    }),
);

app.post(
    "/checkTokenStatus",
    adminAuthMiddleware,
    handleApiRequest(async (req, res) => {
      try {
        getOauth2Client();
      } catch (e) {
        res.json({
          data: {
            isConnected: false,
            email: null,
            error: "La configurazione del server è incompleta. " +
                   "Contatta l'amministratore.",
          },
        });
        return;
      }

      const tokenDocRef = db.collection("googleTokens").doc(getAdminUid());
      const tokenDoc = await tokenDocRef.get();
      const tokens = tokenDoc.data();

      if (tokenDoc.exists && tokens?.refresh_token) {
        try {
          const oauth2Client = getOauth2Client();
          oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
          const calendar = google.calendar({version: "v3", auth: oauth2Client});
          const cal = await calendar.calendars.get({calendarId: "primary"});
          res.json({data: {isConnected: true, email: cal.data.id}});
        } catch (error) {
          await tokenDocRef.delete();
          res.json({
            data: {
              isConnected: false,
              email: null,
              error: "Token non valido. Riconnettersi.",
            },
          });
        }
      } else {
        res.json({data: {isConnected: false, email: null}});
      }
    }),
);

app.post(
    "/disconnectGoogleAccount",
    adminAuthMiddleware,
    handleApiRequest(async (req, res) => {
      const tokenDocRef = db.collection("googleTokens").doc(getAdminUid());
      const tokenDoc = await tokenDocRef.get();
      if (tokenDoc.exists && tokenDoc.data()?.refresh_token) {
        try {
          const token = tokenDoc.data()?.refresh_token;
          await getOauth2Client().revokeToken(token);
        } catch (e) {
          console.error("Revoca token fallita, elimino dal DB.", e);
        }
      }
      await tokenDocRef.delete();
      res.json({data: {success: true}});
    }),
);

app.post(
    "/listGoogleCalendars",
    adminAuthMiddleware,
    handleApiRequest(async (req, res) => {
      const tokenDocRef = db.collection("googleTokens").doc(getAdminUid());
      const tokenDoc = await tokenDocRef.get();
      const tokens = tokenDoc.data();
      if (!tokenDoc.exists || !tokens?.refresh_token) {
        res.status(404).json({error: {message: "Token non trovato."}});
        return;
      }
      const oauth2Client = getOauth2Client();
      oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
      const calendar = google.calendar({version: "v3", auth: oauth2Client});
      const response = await calendar.calendarList.list({});
      const calendarList =
        response.data.items?.map((cal) => ({
          id: cal.id,
          summary: cal.summary,
          primary: cal.primary,
        })) || [];
      res.json({data: calendarList});
    }),
);

// --- ENDPOINT PUBBLICI ---

app.post(
    "/getBusySlotsOnBehalfOfAdmin",
    handleApiRequest(async (req, res) => {
      const {timeMin, timeMax, calendarIds} = req.body.data;
      if (!timeMin || !timeMax || !calendarIds) {
        const err = "timeMin, timeMax e calendarIds obbligatori.";
        res.status(400).json({error: {message: err}});
        return;
      }

      const oauth2Client = getOauth2Client();
      const tokenDocRef = db.collection("googleTokens").doc(getAdminUid());
      const tokenDoc = await tokenDocRef.get();
      const tokens = tokenDoc.data();

      if (!tokenDoc.exists || !tokens?.refresh_token) {
        res.json({data: []});
        return;
      }

      oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
      const calendar = google.calendar({version: "v3", auth: oauth2Client});
      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          items: calendarIds.map((id: string) => ({id})),
        },
      });

      let busyIntervals: {start: string; end: string}[] = [];
      const calendarsData = response.data.calendars;
      if (calendarsData) {
        for (const id in calendarsData) {
          if (Object.prototype.hasOwnProperty.call(calendarsData, id)) {
            const busyPeriods = calendarsData[id].busy;
            if (busyPeriods) {
              const validPeriods = busyPeriods
                  .filter((p) => p.start && p.end)
                  // eslint-disable-next-line
                  .map((p) => ({
                    start: p.start as string,
                    end: p.end as string,
                  }));
              busyIntervals = busyIntervals.concat(validPeriods);
            }
          }
        }
      }
      res.json({data: busyIntervals});
    }),
);

app.post(
    "/createEventOnBehalfOfAdmin",
    handleApiRequest(async (req, res) => {
      const data = req.body.data;
      const oauth2Client = getOauth2Client();
      const tokenDocRef = db.collection("googleTokens").doc(getAdminUid());
      const tokenDoc = await tokenDocRef.get();
      const tokens = tokenDoc.data();

      if (!tokenDoc.exists || !tokens?.refresh_token) {
        res.json({
          data: {
            eventCreated: false,
            eventId: null,
            error: "L'account admin non è collegato a Google Calendar.",
          },
        });
        return;
      }

      oauth2Client.setCredentials({refresh_token: tokens.refresh_token});
      const calendar = google.calendar({version: "v3", auth: oauth2Client});

      const descriptionParts = [
        "<b>Dettagli Cliente:</b>",
        `- Nome: ${data.clientName}`,
        `- Email: ${data.clientEmail}`,
        `- Telefono: ${data.clientPhone}`,
        "<br><br>",
        "<b>Dettagli Lezione:</b>",
        `- Sport: ${data.sport}`,
        `- Tipo: ${data.lessonType}`,
        `- Durata: ${data.duration} min`,
        "<br><br>",
        "<b>Note:</b>",
        `<pre>${data.message || "Nessuna nota."}</pre>`,
      ];
      const eventDescription = descriptionParts.join("<br>");

      const event = {
        summary: `Lezione di ${data.sport} - ${data.clientName}`,
        location: data.location,
        description: eventDescription,
        start: {
          dateTime: data.startTime,
          timeZone: "Europe/Rome",
        },
        end: {
          dateTime: data.endTime,
          timeZone: "Europe/Rome",
        },
        attendees: [{email: data.clientEmail}],
        reminders: {
          useDefault: false,
          overrides: [
            {method: "email", minutes: 24 * 60},
            {method: "popup", minutes: 120},
          ],
        },
      };

      try {
        const response = await calendar.events.insert({
          calendarId: data.targetCalendarId || "primary",
          requestBody: event,
          sendUpdates: "all",
        });
        res.json({
          data: {
            eventCreated: true,
            eventId: response.data.id,
          },
        });
      } catch (err) {
        console.error("Errore creazione evento Google:", err);
        res.json({
          data: {
            eventCreated: false,
            eventId: null,
            error: "Impossibile creare l'evento su Google Calendar.",
          },
        });
      }
    }),
);

// Esporta l'app Express come una singola Cloud Function.
// FIX: Used namespace import `functions.https`.
// FIX: Changed to use imported `https` object.
export const api = https.onRequest(app);
