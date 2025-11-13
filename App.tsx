import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, loginWithEmail, getAppSettings } from './services/firebase';
import { type AppUser, type AppSettings } from './types';
import Spinner from './components/Spinner';
import AdminDashboard from './components/AdminDashboard';
import BookingFlow from './components/BookingFlow';
import { FIREBASE_CONFIG, GOOGLE_API_CONFIG, ADMIN_UID } from './constants';
// import { GoogleCalendarProvider } from './contexts/GoogleCalendarContext'; // Rimosso

type View = 'home' | 'booking' | 'login' | 'admin';

const isConfigured = 
    FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY" && 
    GOOGLE_API_CONFIG.API_KEY !== "YOUR_GOOGLE_API_KEY" && 
    GOOGLE_API_CONFIG.CLIENT_ID !== "YOUR_GOOGLE_CLIENT_ID" &&
    ADMIN_UID !== "YOUR_FIREBASE_ADMIN_USER_ID";

const App: React.FC = () => {
  if (!isConfigured) {
    return <ConfigurationNeededScreen />;
  }

  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
        setLoading(false);
        return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Spinner />
      </div>
    );
  }

  // Rimosso GoogleCalendarProvider
  return (
      <>
          {user ? <AdminDashboard user={user} /> : <PublicApp />}
      </>
  );
};

const PublicApp: React.FC = () => {
    const [view, setView] = useState<View>('home');
    const [selectedSport, setSelectedSport] = useState<string | null>(null);

    const handleSelectSport = (sport: string) => {
        setSelectedSport(sport);
        setView('booking');
    };

    const handleBackToHome = () => {
        setSelectedSport(null);
        setView('home');
    };

    switch(view) {
        case 'booking':
            return selectedSport ? <BookingPage sport={selectedSport} onBack={handleBackToHome} /> : <HomeScreen onSelectSport={handleSelectSport} setView={setView} />;
        case 'login':
            return <LoginScreen onBack={handleBackToHome} />;
        case 'home':
        default:
            return <HomeScreen onSelectSport={handleSelectSport} setView={setView} />;
    }
}


// =================================================================
// Schermata di avviso per la configurazione
// =================================================================

const ConfigurationNeededScreen: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-red-900/20 p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 border-4 border-red-500">
            <div className="text-center">
                <svg className="mx-auto h-16 w-16 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <h1 className="text-3xl font-extrabold text-gray-800 mt-4">Configurazione Richiesta</h1>
                <p className="text-gray-600 mt-2 text-lg">
                    L'applicazione non può avviarsi perché le credenziali di Firebase, Google o l'Admin UID non sono state impostate.
                </p>
            </div>
            <div className="mt-8 text-left">
                <h2 className="text-xl font-bold text-gray-700">Cosa fare:</h2>
                <ol className="list-decimal list-inside mt-4 space-y-3 text-gray-700">
                    <li>Apri il file <code className="bg-gray-200 text-red-700 font-mono px-2 py-1 rounded">constants.ts</code> nel tuo editor di codice.</li>
                    <li>Sostituisci i valori segnaposto con le tue credenziali reali per Firebase, Google e il tuo <code className="bg-gray-200 font-mono px-2 py-1 rounded">ADMIN_UID</code>.</li>
                </ol>
            </div>
        </div>
    </div>
  );
};


// =================================================================
// Sub-components per le diverse viste
// =================================================================

const HomeScreen: React.FC<{onSelectSport: (sport: string) => void, setView: (view: View) => void}> = ({ onSelectSport, setView }) => {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSettings = async () => {
            setLoading(true);
            const appSettings = await getAppSettings();
            setSettings(appSettings);
            setLoading(false);
        };
        fetchSettings();
    }, []);

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>
    }
    
    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-emerald-900 to-black p-4 relative">
          <div className="text-center">
            {settings?.profilePhotoUrl && (
                <img src={settings.profilePhotoUrl} alt="Profilo" className="w-32 h-32 rounded-full mx-auto mb-6 border-4 border-gray-700 shadow-lg" />
            )}
            <h1 className="text-5xl font-bold text-white mt-4 drop-shadow-lg">{settings?.welcomeTitle}</h1>
            <p className="text-gray-300 text-lg mt-2 mb-10 drop-shadow-md max-w-2xl">
              {settings?.welcomeMessage}
            </p>
            <div className="flex flex-wrap justify-center gap-8">
              {settings?.services?.map(service => (
                  <SportCard key={service.id} sport={service.name} emoji={service.emoji} onClick={() => onSelectSport(service.name)} />
              ))}
            </div>
          </div>
          <button 
            onClick={() => setView('login')}
            aria-label="Area Amministratore"
            className="absolute bottom-6 right-6 bg-gray-800/80 backdrop-blur-sm p-3 rounded-full shadow-lg hover:bg-gray-700 hover:scale-110 transition-transform duration-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
    );
};

const SportCard: React.FC<{sport: string; emoji: string; onClick: () => void}> = ({ sport, emoji, onClick }) => {
    const isImage = emoji.startsWith('data:image/');

    return (
      <div 
        onClick={onClick}
        className="bg-gray-800/60 backdrop-blur-md border border-gray-700 p-8 rounded-2xl shadow-2xl w-64 h-64 flex flex-col items-center justify-center cursor-pointer transform hover:-translate-y-2 transition-transform duration-300"
      >
        {isImage ? (
          <img src={emoji} alt={`${sport} icon`} className="w-48 h-48 object-contain drop-shadow-lg" />
        ) : (
          <span className="text-8xl drop-shadow-lg">{emoji}</span>
        )}
        <h2 className="text-3xl font-bold text-white mt-4">{sport}</h2>
      </div>
    );
};


const LoginScreen: React.FC<{onBack: () => void}> = ({ onBack }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);
        try {
            await loginWithEmail(email, password);
            // L'onAuthStateChanged in App.tsx gestirà il cambio di vista
        } catch (err: any) {
            setError("Credenziali non valide. Riprova.");
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-700 via-gray-900 to-black p-4 relative">
            <button 
                onClick={onBack}
                className="absolute top-6 left-6 bg-gray-800/50 text-white py-2 px-4 rounded-full hover:bg-gray-700/80 transition"
            >
                 &larr; Torna alla Home
            </button>
          <div className="text-center bg-gray-800 backdrop-blur-sm p-10 rounded-2xl shadow-2xl max-w-md w-full border border-gray-700">
            <span className="text-7xl" role="img" aria-label="gear icon">⚙️</span>
            <h1 className="text-4xl font-bold text-white mt-4">Accesso Admin</h1>
            <p className="text-gray-300 mt-2 mb-8">
              Accedi per gestire il tuo calendario e le prenotazioni.
            </p>
            <form onSubmit={handleLogin}>
                <div className="mb-4 text-left">
                    <label htmlFor="email" className="block text-sm font-medium text-gray-400 mb-1">Email</label>
                    <input
                        type="email"
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full p-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition placeholder-gray-400"
                        placeholder="admin@email.com"
                    />
                </div>
                <div className="mb-6 text-left">
                    <label htmlFor="password" className="block text-sm font-medium text-gray-400 mb-1">Password</label>
                    <input
                        type="password"
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full p-3 bg-gray-700 border border-gray-600 text-white rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition placeholder-gray-400"
                        placeholder="password"
                    />
                </div>
                {error && <p className="text-red-400 text-center mb-4">{error}</p>}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-4 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 disabled:bg-emerald-800"
                >
                  {isLoading ? <Spinner /> : 'Accedi'}
                </button>
            </form>
            <p className="text-xs text-gray-500 mt-4">
                (Assicurati di aver creato questo utente nella tua console Firebase Authentication)
            </p>
          </div>
        </div>
    );
};

const BookingPage: React.FC<{sport: string, onBack: () => void}> = ({ sport, onBack }) => {
    return (
        <div className="bg-gray-900 min-h-screen">
             <div className="container mx-auto p-4 md:p-8">
                <button onClick={onBack} className="mb-6 text-emerald-400 hover:text-emerald-300 font-semibold">&larr; Cambia Sport</button>
                <BookingFlow sport={sport} />
            </div>
        </div>
    );
};

export default App;
