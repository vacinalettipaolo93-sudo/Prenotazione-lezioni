'use strict';
/**
 * Wrapper: re-export the compiled function in ../lib/index.js
 * This allows the emulator (which loads source "functions/api") to run the code
 * that lives in functions/lib/index.js (il JS compilato).
 */
const mod = require('../lib/index.js');
exports.api = mod.api || (mod && mod.default && mod.default.api) || mod;
