const FUNCTIONS_BASE = (import.meta.env?.VITE_FUNCTIONS_BASE_URL as string) || "https://us-central1-gestionale-prenotazioni-lezio.cloudfunctions.net/api";

export type BusySlot = { startISO: string; endISO: string };

export async function fetchBusySlotsForWindow(locationId: string, timeMinISO: string, timeMaxISO: string, slotDurationMinutes = 30, slotStepMinutes?: number): Promise<BusySlot[]> {
  if (!slotStepMinutes) slotStepMinutes = slotDurationMinutes;
  const payload = {
    locationId,
    data: { timeMin: timeMinISO, timeMax: timeMaxISO },
    slotDurationMinutes,
    slotStepMinutes
  };
  const resp = await fetch(`${FUNCTIONS_BASE}/getBusySlotsOnBehalfOfAdmin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const txt = await resp.text();
  const json = txt ? JSON.parse(txt) : null;
  if (!resp.ok) throw new Error(json?.message || json?.error || `Function returned ${resp.status}`);
  return json.slots || [];
}

export async function createBooking(payload: {
  locationId: string;
  serviceId?: string;
  dateISO: string;
  durationMinutes?: number;
  clientName: string;
  clientEmail?: string;
  notes?: string;
}) {
  const resp = await fetch(`${FUNCTIONS_BASE}/createBooking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.message || json?.error || `Booking failed ${resp.status}`);
  return json;
}