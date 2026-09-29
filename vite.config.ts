import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Пути REST API Gateway (api/v1/openapi.yaml). В dev проксируем их на Gateway,
// чтобы не упираться в CORS и не хардкодить адрес узла в бандле.
const API_PREFIXES = ['/login', '/register', '/refresh', '/logout', '/catalog', '/stream', '/admin'];

const BASE = '/admin/';

// Vite отдаёт 404 на базовый путь без слэша (/admin), а роутер ведёт на него ссылкой «Обзор».
// Редиректим на /admin/, чтобы открывалось и со слэшем, и без.
const redirectBase: Connect.NextHandleFunction = (req, res, next) => {
  const [path, query] = (req.url ?? '').split('?');
  if (path !== BASE.slice(0, -1)) return next();
  res.statusCode = 301;
  res.setHeader('Location', BASE + (query ? `?${query}` : ''));
  res.end();
};

const baseWithoutSlash = (): Plugin => ({
  name: 'base-without-slash',
  configureServer: (server) => void server.middlewares.use(redirectBase),
  configurePreviewServer: (server) => void server.middlewares.use(redirectBase),
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const gateway = env.GATEWAY_URL || 'http://localhost:8080';

  return {
    base: BASE,
    plugins: [react(), baseWithoutSlash()],
    server: {
      port: 5174,
      proxy: Object.fromEntries(API_PREFIXES.map((p) => [p, { target: gateway, changeOrigin: true }])),
    },
    preview: {
      port: 5174,
      proxy: Object.fromEntries(API_PREFIXES.map((p) => [p, { target: gateway, changeOrigin: true }])),
    },
  };
});
