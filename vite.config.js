import { defineConfig } from 'vite';

// The dev server is reached through the sandbox preview proxy, whose hostname is
// supplied at runtime via the platform-provided
// `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` env var (native Vite >= 6.1 support),
// so no host allowlist is hardcoded here.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
});
