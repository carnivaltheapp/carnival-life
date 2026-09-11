export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        URL: "readonly",
        CustomEvent: "readonly",
        Element: "readonly",
        chrome: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        crypto: "readonly",
        decodeURIComponent: "readonly",
        document: "readonly",
        setTimeout: "readonly",
        Map: "readonly",
        window: "readonly",
      },
      sourceType: "module",
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
