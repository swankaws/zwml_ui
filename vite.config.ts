import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base so the bundle works under a GitHub Pages project path
  // (/zwml_ui/), from a local `vite preview`, or from a file:// fallback.
  base: './',
  build: {
    // Assets are content-hashed, which is what makes the Pages `max-age=600`
    // cache survivable. See docs/DESIGN.md §10.
    assetsDir: 'assets',
    sourcemap: true,
  },
})
