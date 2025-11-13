import esbuild from 'esbuild';
import { copyFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
// Rimuoviamo la dipendenza da readFileSync perché non leggeremo più file
// import { readFileSync } from 'fs';

/**
 * Prepara le variabili d'ambiente per la sostituzione da parte di esbuild.
 * Itera su `process.env` (l'ambiente del processo di build di Node.js,
 * fornito da Vercel) e seleziona solo le chiavi che iniziano con 'VITE_'.
 * @returns {Record<string, string>} Un oggetto per la proprietà 'define' di esbuild.
 */
function getEnvVars() {
    const envVars = {};
    for (const key in process.env) {
        // Cerchiamo le variabili che il nostro codice si aspetta (quelle con prefisso VITE_)
        if (key.startsWith('VITE_')) {
            envVars[`process.env.${key}`] = JSON.stringify(process.env[key]);
        }
    }
    
    const varCount = Object.keys(envVars).length;
    if (varCount > 0) {
        console.log(`✅ Trovate e iniettate ${varCount} variabili d'ambiente VITE_ dall'ambiente di build.`);
    } else {
        console.warn(
            "ATTENZIONE: Nessuna variabile d'ambiente con prefisso 'VITE_' trovata nell'ambiente di build. " +
            "L'applicazione userà i valori di fallback definiti in constants.ts. " +
            "Assicurati che le variabili siano impostate correttamente su Vercel."
        );
    }

    return envVars;
}

try {
    // Assicura che la directory 'dist' esista
    await mkdir('dist', { recursive: true });

    // Compila i file TSX/TS
    await esbuild.build({
        entryPoints: ['index.tsx'],
        bundle: true,
        outfile: 'dist/index.js',
        minify: true,
        define: {
            'process.env.NODE_ENV': '"production"',
            ...getEnvVars(), // Inietta le variabili d'ambiente dall'ambiente Vercel
        },
        loader: { '.tsx': 'tsx', '.ts': 'ts' },
    });
    console.log('✅ Build del frontend completato con successo.');

    // Copia index.html in dist
    await copyFile('index.html', 'dist/index.html');
    console.log('✅ index.html copiato in dist.');

} catch (e) {
    console.error('Build del frontend fallito:', e);
    process.exit(1);
}
