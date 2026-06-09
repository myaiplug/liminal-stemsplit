import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  {
    files: ['src/**/*.{js,jsx,ts,tsx}', 'next.config.js'],
    rules: {
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      'import/no-anonymous-default-export': 'off',
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'dist/**',
      'embedded_python/**',
      'installers/**',
      'billing-service/data/**',
      'src-tauri/**',
      'build/**',
      'eslint.config.mjs',
      '*.log',
    ],
  },
];

export default [
  ...config,
];
