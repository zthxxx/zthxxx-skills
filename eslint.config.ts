import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  markdown: false,
  ignores: [
    'node_modules',
    'dist',
  ],
}, {
  rules: {
    // bun project — top-level await is standard pattern
    'antfu/no-top-level-await': 'off',
    // bun uses global process/Buffer natively
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
  },
})
