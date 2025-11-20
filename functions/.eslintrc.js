module.exports = {
  root: true,
  env: {
    es6: true,

    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json"],
    sourceType: "module",
    tsconfigRootDir: __dirname,
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "*.js", // Ignore generated JS files
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,
    "require-jsdoc": 0,
    "max-len": ["warn", { "code": 120 }],
    "object-curly-spacing": ["error", "never"],
    "camelcase": "warn",
    "@typescript-eslint/no-var-requires": 0,
    "valid-jsdoc": "off",
    // FIX: Disable base indent rule and enable TypeScript-specific rule for 4-space indentation.
    "indent": "off",
    "@typescript-eslint/indent": ["error", 4],
  },
};
