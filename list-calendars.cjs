const { google } = require('googleapis');

(async () => {
  try {
    const creds = require('./service-account.json');
    // Usa GoogleAuth con le credenziali direttamente (più robusto del costruttore JWT in alcuni ambienti)
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const client = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: client });
    const res = await calendar.calendarList.list();
    console.log("Calendari visibili al service account:");
    console.log(JSON.stringify(res.data.items || [], null, 2));
  } catch (err) {
    if (err && err.response && err.response.data) {
      console.error("Errore listing calendars:", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error("Errore listing calendars:", err && err.message ? err.message : err);
      console.error(err);
    }
    process.exitCode = 1;
  }
})();