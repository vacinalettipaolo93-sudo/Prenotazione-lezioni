const { google } = require('googleapis');

(async () => {
  try {
    const calendarId = process.argv[2];
    if (!calendarId) {
      console.error('Usage: node add-to-calendarList.cjs <calendarId>');
      process.exit(1);
    }
    const creds = require('./service-account.json');
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const client = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: client });
    const res = await calendar.calendarList.insert({ requestBody: { id: calendarId }});
    console.log("Added to calendarList:", JSON.stringify(res.data, null, 2));
  } catch (err) {
    if (err && err.response && err.response.data) {
      console.error("Errore calendarList.insert:", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error("Errore calendarList.insert:", err && err.message ? err.message : err);
      console.error(err);
    }
    process.exitCode = 1;
  }
})();