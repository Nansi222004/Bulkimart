// https://docs.expo.dev/guides/using-eslint/
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  globalIgnores(['dist/*', 'android/*', 'ios/*', 'src/shared/*', 'src/lib/celebrationRenderer.js']),
  expoConfig,
  {
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      // React Compiler rules: the compiler is not enabled in this app, and these flag the standard React Native
      // patterns ported from the web (Animated.Value refs, state set from effects, expo-video player props).
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      // `export *` re-exports (expo-notifications enums) are not resolved by the import plugin.
      'import/namespace': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
]);
