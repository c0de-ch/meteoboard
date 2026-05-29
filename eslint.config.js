const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'data/**'] },

  js.configs.recommended,

  // Backend / scripts / tests (CommonJS, Node).
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // Frontend (classic browser scripts sharing globals across files).
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, Chart: 'readonly' },
    },
    rules: {
      // Globals (WindRose/Widgets/Charts/init/…) are intentionally shared
      // across separate <script> files, so cross-file references are expected.
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
];
