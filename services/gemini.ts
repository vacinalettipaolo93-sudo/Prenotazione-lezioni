import { GoogleGenAI, Type } from "@google/genai";
import { type AppSettings, type AICompletions } from "../types";
import { getAppSettings } from './firebase';

// L'app non usa un bundler come Vite, quindi `process.env` non è
// automaticamente disponibile nel browser. Usiamo un controllo per accedere
// in modo sicuro a `process.env` in un ambiente non-Node, prevenendo un crash.
// L'ambiente di esecuzione è responsabile di fornire la variabile API_KEY.
const env = (typeof process !== 'undefined' && process.env) ? process.env : {};

// The API key MUST be obtained exclusively from the environment variable process.env.API_KEY.
// This environment variable is assumed to be pre-configured and accessible.
const ai = new GoogleGenAI({apiKey: env.API_KEY!});

export const parseBookingRequest = async (prompt: string): Promise<AICompletions> => {
    const settings: AppSettings | null = await getAppSettings();
    if (!settings) {
        throw new Error("Could not load app settings for AI context.");
    }
    
    const availableSports = settings.services?.map(s => s.name).join(', ') || 'tennis, padel';
    const availableLocations = settings.locations?.map(l => l.name).join(', ') || 'Salò, Manerba';

    const systemInstruction = `
        Sei un assistente per la prenotazione di lezioni di sport. Il tuo compito è analizzare la richiesta dell'utente e estrarre le informazioni in un formato JSON strutturato.
        
        Le informazioni disponibili sono:
        - Sport disponibili: ${availableSports}
        - Sedi disponibili: ${availableLocations}

        Regole:
        1. Se l'utente non specifica uno sport tra quelli disponibili, lascia il campo 'sport' vuoto. Lo sport è l'informazione più importante.
        2. Interpreta le date relative come "domani", "prossima settimana", "martedì prossimo" e convertile in un formato YYYY-MM-DD. Oggi è ${new Date().toISOString().split('T')[0]}.
        3. Se l'utente menziona un momento della giornata (es. mattina, pomeriggio, sera), popola il campo 'timeOfDay'.
        4. Se l'utente menziona una sede, popola il campo 'location'. Se non corrisponde esattamente a una delle sedi disponibili, trova quella più simile.
        5. Se l'utente menziona un numero di persone, popola il campo 'people'.
    `;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            sport: { type: Type.STRING, description: `Uno tra [${availableSports}]` },
            date: { type: Type.STRING, description: 'La data richiesta in formato YYYY-MM-DD' },
            timeOfDay: { type: Type.STRING, description: 'Momento della giornata (es. mattina, pomeriggio, sera)' },
            location: { type: Type.STRING, description: `Una tra [${availableLocations}]` },
            people: { type: Type.NUMBER, description: 'Il numero di persone per la lezione' },
        },
    };

    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        
        const jsonText = response.text.trim();
        return JSON.parse(jsonText);

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw new Error("Failed to parse booking request with AI.");
    }
};
