export default [
  {
    // Agent tooling installs itself into the working tree — vendored browser and
    // Playwright code that is git-ignored and not part of this project. ESLint
    // walks the filesystem rather than the index, so without this a developer
    // running `npm run lint` sees dozens of undefined-global errors in files
    // nobody here wrote.
    ignores: ['.agents/**', '.claude/**', '.github/skills/**', '.github/prompts/**'],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setInterval: 'readonly',
        setImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Buffer: 'readonly',
        TextDecoder: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-constant-condition': 'warn',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'eqeqeq': ['warn', 'smart'],
    },
  },
];
