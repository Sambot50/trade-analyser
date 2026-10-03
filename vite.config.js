import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Port épinglé. Sans `strictPort`, Vite glisse en silence sur 5174, 5175…
  // quand une instance traîne : on ouvre alors l'ancienne version sans le
  // savoir, ou une page morte. Mieux vaut un refus net qu'un port surprise.
  server: { port: 5173, strictPort: true },
  plugins: [react(), tailwindcss()],
});
