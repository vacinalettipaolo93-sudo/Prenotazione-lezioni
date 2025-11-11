import React, { useState } from 'react';
import Spinner from './Spinner';
import { parseBookingRequest } from '../services/gemini';
import { type AICompletions } from '../types';

interface AICompanionProps {
    onBookingParsed: (details: AICompletions) => void;
}

const AICompanion: React.FC<AICompanionProps> = ({ onBookingParsed }) => {
    const [prompt, setPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim()) return;

        setLoading(true);
        setError(null);
        try {
            const result = await parseBookingRequest(prompt);
            if(result.sport) {
                onBookingParsed(result);
            } else {
                setError("Non sono riuscito a capire la tua richiesta. Prova a specificare lo sport e un'indicazione di quando vorresti giocare.");
            }
        } catch (err) {
            console.error(err);
            setError("Si è verificato un errore con l'assistente AI. Riprova.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mt-16 text-center w-full max-w-2xl mx-auto">
            <h3 className="text-2xl font-semibold text-gray-300 mb-2">Non sai da dove iniziare?</h3>
            <p className="text-emerald-400 mb-4 font-medium">Chiedi all'Assistente AI!</p>
            <form onSubmit={handleSubmit} className="bg-gray-800/70 backdrop-blur-sm p-4 rounded-xl border border-gray-700 shadow-lg flex flex-col sm:flex-row items-center gap-3">
                <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Es: Una lezione di tennis per 2 persone martedì pomeriggio a Salò"
                    className="flex-grow w-full p-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-emerald-500 placeholder-gray-400 transition"
                />
                <button type="submit" disabled={loading} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-lg transition disabled:bg-emerald-800">
                    {loading ? <Spinner /> : (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                            <span>Chiedi</span>
                        </>
                    )}
                </button>
            </form>
            {error && <p className="text-red-400 mt-3">{error}</p>}
        </div>
    );
};

export default AICompanion;