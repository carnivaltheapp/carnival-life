export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        URL: "readonly",
        chrome: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        setTimeout: "readonly",
      },
      sourceType: "module",
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
