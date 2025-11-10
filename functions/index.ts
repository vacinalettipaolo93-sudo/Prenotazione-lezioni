/**
 * This file serves as the entry point for Firebase Functions.
 * It exports the 'api' function, which is the new Express server implementation,
 * replacing the previous architecture of multiple individual Cloud Functions.
 *
 * All application logic is now contained within 'functions/src/index.ts'.
 */

// FIX: This file contained outdated, compiled JavaScript code that was incorrectly
// being treated as TypeScript, causing numerous compilation errors.
// It has been replaced with a simple re-export of the new 'api' function from
// the source file, aligning with the project's new architecture.
export { api } from "./src/index";
