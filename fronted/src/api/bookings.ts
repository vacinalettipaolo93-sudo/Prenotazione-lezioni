export async function checkSlot(startISO: string, endISO: string) {
  const resp = await fetch('/.netlify/functions/checkSlotFree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startISO, endISO })
  });
  return resp.json();
}

export async function createBookingApi(payload: {
  startISO: string;
  endISO: string;
  location: string;
  sportType: string;
  user: { id?: string; name: string; email: string };
  attendees?: Array<{ email: string }>;
}) {
  const resp = await fetch('/.netlify/functions/createBooking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return resp.json();
}