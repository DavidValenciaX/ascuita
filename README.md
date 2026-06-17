# Ascuita

Ascuita es una aplicación web para crear, probar y conversar con personajes de IA en tiempo real usando Gemini Live API. El proyecto parte del código original publicado por Google, pero ahora incluye cambios importantes en identidad, animación del personaje, configuración, experiencia de usuario y soporte multilenguaje.

Actualmente el repositorio usa una arquitectura `monorepo`:

* `apps/web`: frontend Vite + React desplegado en Firebase Hosting.
* `apps/api`: backend Node + Fastify + WebSocket desplegado en una VPS y encargado de hablar con Gemini.

## Características

* **Personaje 3D con Three.js**: el avatar ya no depende de bocas SVG. El cuerpo, ojos, brillo, movimiento y orientación se renderizan como una escena 3D.
* **Boca procedural sincronizada con audio**: el lip sync usa análisis de audio y visemas inspirados en Adobe Character Animator; la boca se dibuja dinámicamente sobre una textura de canvas aplicada al personaje 3D.
* **Agentes personalizables**: puedes elegir presets, crear agentes propios y ajustar nombre, personalidad, voz y color.
* **Soporte en español e inglés**: la interfaz cambia de idioma según el navegador y permite alternar idioma desde la configuración.
* **Panel de configuración de animación**: incluye controles para ajustar sensibilidad, suavizado y comportamiento de la boca.
* **Gemini Live API securizada**: el navegador ya no usa la API key directamente; el backend actúa como proxy seguro hacia Gemini Live.

## Requisitos

* Node.js `>=20.0.0`.
* Una API key de Google Gemini.
* Acceso a un modelo compatible con Gemini Live API.

La versión mínima de Node se declara en `package.json`. Aunque Vite puede funcionar con Node 18, la versión instalada de `@google/genai` exige Node 20 o superior.

## Configuración Local

### 1. Instalar dependencias

```bash
npm install
```

### 2. Crear variables del backend

Crea `apps/api/.env` con este contenido:

```env
HOST=127.0.0.1
PORT=3000
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173
GEMINI_API_KEY=tu_clave_real
GEMINI_MODEL=gemini-3.1-flash-live-preview
```

### 3. Crear variables del frontend

Crea `apps/web/.env.local` con este contenido:

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_GEMINI_MODEL=gemini-3.1-flash-live-preview
VITE_DEBUG_MODE=true
VITE_FIREBASE_CONFIG={"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"...","measurementId":"..."}
```

### 4. Arrancar backend y frontend a la vez

```bash
npm run dev
```

Esto levanta:

* backend en `http://localhost:3000`
* frontend en `http://localhost:5173`

### 5. Arrancar cada servicio por separado

Backend:

```bash
npm run dev:api
```

Frontend:

```bash
npm run dev:web
```

### 6. Probar builds locales

```bash
npm run build:api
npm run build:web
```

## Scripts

* `npm run dev`: inicia backend y frontend a la vez.
* `npm run dev:api`: inicia el backend en modo desarrollo.
* `npm run dev:web`: inicia el frontend en modo desarrollo.
* `npm run build:api`: compila el backend.
* `npm run build:web`: compila el frontend.
* `npm run build`: compila frontend y backend.
* `npm run preview:web`: sirve localmente el build de producción del frontend.

## Despliegue

La arquitectura de despliegue actual es esta:

* `apps/web` se despliega a Firebase Hosting.
* `apps/api` se despliega a una VPS Ubuntu con `Nginx + pm2`.
* `Nginx` expone HTTPS y reenvía tráfico WebSocket al backend Node.

### Frontend en Firebase

Variables esperadas por el workflow de frontend:

* `VITE_FIREBASE_CONFIG`
* `VITE_API_BASE_URL`
* `VITE_GEMINI_MODEL`
* `VITE_DEBUG_MODE`

### Backend en VPS

Variables esperadas en la VPS para `apps/api/.env`:

* `HOST`
* `PORT`
* `LOG_LEVEL`
* `CORS_ORIGIN`
* `GEMINI_API_KEY`
* `GEMINI_MODEL`

Importante: `GEMINI_API_KEY` solo debe existir en el backend y nunca en el build del frontend.

## Licencia y Atribución

Este proyecto conserva la licencia Apache 2.0 del código original:

* Código original: Copyright 2024 Google LLC, licenciado bajo Apache License, Version 2.0.
* Modificaciones: publicadas bajo la misma licencia Apache License, Version 2.0.

Consulta [LICENSE](LICENSE) para más detalles.
