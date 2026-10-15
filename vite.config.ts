import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dos páginas, un mismo proyecto Supabase:
//   index.html  → panel del dueño (login, aprobación, administración)
//   ventas.html → punto de venta para cajeras
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ventas: fileURLToPath(new URL('./ventas.html', import.meta.url)),
      },
      output: {
        // Gráficos y Excel solo los usa el panel del dueño; así la página de ventas carga más liviana.
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'xlsx'
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          if (/node_modules\/(recharts|d3-|victory-vendor|decimal\.js-light|internmap|es-toolkit)/.test(id)) return 'charts'
          return undefined
        },
      },
    },
  },
})
