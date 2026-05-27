# Ascuita

Ascuita es una aplicación web para crear, probar y conversar con personajes de IA en tiempo real usando Gemini Live API. El proyecto parte del código original publicado por Google, pero ahora incluye cambios importantes en identidad, animación del personaje, configuración, experiencia de usuario y soporte multilenguaje.

## Características

* **Personaje 3D con Three.js**: el avatar ya no depende de bocas SVG. El cuerpo, ojos, brillo, movimiento y orientación se renderizan como una escena 3D.
* **Boca procedural sincronizada con audio**: el lip sync usa análisis de audio y visemas inspirados en Adobe Character Animator; la boca se dibuja dinámicamente sobre una textura de canvas aplicada al personaje 3D.
* **Agentes personalizables**: puedes elegir presets, crear agentes propios y ajustar nombre, personalidad, voz y color.
* **Soporte en español e inglés**: la interfaz cambia de idioma según el navegador y permite alternar idioma desde la configuración.
* **Panel de configuración de animación**: incluye controles para ajustar sensibilidad, suavizado y comportamiento de la boca.
* **Gemini Live API**: usa `@google/genai` para la conversación multimodal en tiempo real.

## Requisitos

* Node.js `>=20.0.0`.
* Una API key de Google Gemini.
* Acceso a un modelo compatible con Gemini Live API.

La versión mínima de Node se declara en `package.json`. Aunque Vite puede funcionar con Node 18, la versión instalada de `@google/genai` exige Node 20 o superior.

## Configuración Local

1. Instala las dependencias:

    ```bash
    npm install
    ```

2. Crea un archivo `.env.local` en la raíz del proyecto con estas variables:

    ```env
    GEMINI_API_KEY=your_api_key_here
    GEMINI_MODEL=gemini-3.1-flash-live-preview
    DEBUG_MODE=false
    ```

    `DEBUG_MODE=true` muestra información técnica adicional en la interfaz, como el modelo activo.

3. Ejecuta el servidor de desarrollo:

    ```bash
    npm run dev
    ```

4. Abre la URL que muestre Vite, normalmente `http://localhost:5173`.

## Scripts

* `npm run dev`: inicia Vite en modo desarrollo.
* `npm run build`: genera la versión de producción en `dist`.
* `npm run preview`: sirve localmente el build de producción.

## Despliegue

Ascuita es una app Vite/React y puede desplegarse en plataformas de hosting estático como Netlify, Vercel o similares.

Configura el build así:

* Build command: `npm run build`
* Publish directory: `dist`
* Environment variables: `GEMINI_API_KEY`, `GEMINI_MODEL` y `DEBUG_MODE`

Importante: estas variables se inyectan durante el build de Vite. En esta arquitectura, el cliente del navegador usa la API key para conectarse a los servicios de Google.

## Licencia y Atribución

Este proyecto conserva la licencia Apache 2.0 del código original:

* Código original: Copyright 2024 Google LLC, licenciado bajo Apache License, Version 2.0.
* Modificaciones: publicadas bajo la misma licencia Apache License, Version 2.0.

Consulta [LICENSE](LICENSE) para más detalles.
