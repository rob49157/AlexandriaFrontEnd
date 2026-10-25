import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The decryption Lit Action only accepts unlock messages signed for
  // "localhost:5173" (UNLOCK_ALLOWED_DOMAINS in src/services/litAction.js).
  // Without strictPort, Vite quietly moves to 5174 when 5173 is busy and every
  // book fails to open with auth_domain.
  server: { port: 5173, strictPort: true },
})
