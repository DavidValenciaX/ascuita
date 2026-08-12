# Ascuita

Ascuita es una aplicación web para crear, probar y conversar con personajes de IA en tiempo real usando Gemini Live API. El proyecto parte del código original publicado por Google, pero ahora incluye cambios importantes en identidad, animación del personaje, autenticación, persistencia de conversaciones, seguridad, experiencia de usuario y soporte multilenguaje.

Actualmente el repositorio usa una arquitectura `monorepo`:

* `apps/web`: frontend Vite + React + Zustand desplegado en Firebase Hosting.
* `apps/api`: backend Node + Fastify + WebSocket desplegado en Cloud Run y encargado de hablar con Gemini Live API de forma segura.

## Capturas de pantalla

### Escritorio

![Interfaz de escritorio](docs/images/screenshot_desktop_ui.webp)

### Móvil

![Interfaz móvil](docs/images/screenshot_mobile_ui.jpg)

## Características

* **Personaje 3D con Three.js**: el avatar ya no depende de bocas SVG. El cuerpo, ojos, brillo, movimiento y orientación se renderizan como una escena 3D.
* **Boca procedural sincronizada con audio**: el lip sync usa análisis de audio y visemas inspirados en Adobe Character Animator; la boca se dibuja dinámicamente sobre una textura de canvas aplicada al personaje 3D.
* **Agentes personalizables**: puedes elegir presets, crear agentes propios y ajustar nombre, personalidad, voz y color.
* **Autenticación con Google (Firebase Auth)**: los usuarios pueden iniciar sesión con su cuenta de Google. El backend verifica los tokens de Firebase Admin SDK.
* **Trial gratuito para invitados**: los usuarios no autenticados pueden probar la aplicación durante un tiempo limitado (por defecto 3 minutos) antes de necesitar iniciar sesión.
* **Persistencia de conversaciones (Firestore)**: las conversaciones y mensajes se guardan en Firestore. Los usuarios pueden ver su historial y retomar conversaciones anteriores.
* **Memorias persistentes para usuarios registrados**: están activadas por defecto y Ascuita puede guardar recuerdos breves y no sensibles que el modelo considere útiles para personalizar futuras conversaciones. Se pueden revisar, exportar, borrar o desactivar desde Configuración.
* **Soporte en español e inglés**: la interfaz cambia de idioma según el navegador y permite alternar idioma desde la configuración.
* **Panel de configuración de animación**: incluye controles para ajustar sensibilidad, suavizado y comportamiento de la boca.
* **Temas claro/oscuro**: la escena 3D puede alternar entre tema oscuro y claro.
* **Gemini Live API securizada**: el navegador ya no usa la API key directamente; el backend actúa como proxy seguro hacia Gemini Live.
* **Seguridad y rate limiting**: el backend implementa rate limiting HTTP y WebSocket, límites de conexiones concurrentes por IP, límites de tamaño de payload, límites de bytes de audio por ventana de tiempo, bloqueo temporal de IPs abusivas, headers de seguridad y logs de abuso con retención configurable.
* **Endpoint de salud**: el backend expone `GET /health` para monitoreo.

## Requisitos

* Node.js `>=20.0.0`.
* Una API key de Google Gemini.
* Acceso a un modelo compatible con Gemini Live API.
* Un proyecto de Firebase con Authentication (Google Sign-In) y Firestore habilitados.

La versión mínima de Node se declara en `package.json`. Aunque Vite puede funcionar con Node 18, la versión instalada de `@google/genai` exige Node 20 o superior. Los workflows de CI usan Node 22.

## Configuración Local

### 1. Instalar dependencias

```bash
npm install
```

### 2. Crear variables del backend

Crea `apps/api/.env` con este contenido (consulta `apps/api/.env.example` para la lista completa):

```env
HOST=127.0.0.1
PORT=3000
CORS_ORIGIN=http://localhost:5173
GEMINI_API_KEY=tu_clave_real
GEMINI_MODEL=gemini-3.1-flash-live-preview

# Firebase Admin SDK (necesario para Auth y Firestore en el backend)
# En local puedes usar variables explícitas; en Cloud Run se recomienda
# usar la service account adjunta al servicio.
FIREBASE_PROJECT_ID=tu_project_id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@tu-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\ntu_clave\n-----END PRIVATE KEY-----\n"

# Configuración opcional
SECURITY_LOG_DIR=logs/security
```

`CORS_ORIGIN` admite múltiples orígenes separados por comas. Si no se define, se usan valores por defecto que incluyen `localhost:5173`, `localhost:4173`, `https://localhost` para Capacitor Android y el dominio de producción.
Los parámetros de `LOG_LEVEL`, rate limiting, trial gratuito y retención de logs están fijados como constantes en [`apps/api/src/config.ts`](file:///c:/Users/David/Downloads/Programacion/AI_apps/ascuita/apps/api/src/config.ts), así que ya no se configuran mediante variables de entorno.

### 3. Crear variables del frontend

Crea `apps/web/.env.local` con este contenido:

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_GEMINI_MODEL=gemini-3.1-flash-live-preview
VITE_DEBUG_MODE=true
VITE_FIREBASE_CONFIG={"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"...","measurementId":"..."}
```

`VITE_FIREBASE_CONFIG` debe contener el JSON de configuración del SDK de Firebase web (disponible en la consola de Firebase > Project Settings > Web App).

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
* `npm run test:rules`: ejecuta los tests de reglas de Firestore mediante el emulador local.
* `npm run preview:web`: sirve localmente el build de producción del frontend.
* `npm run mobile:sync`: compila la web móvil y sincroniza Capacitor con Android.
* `npm run mobile:open`: abre el proyecto Android en Android Studio.
* `npm run mobile:apk`: genera un APK debug instalable.
* `npm run mobile:apk:release`: genera un APK release si existe la configuración de firma.
* `npm run mobile:aab`: genera el AAB release para Google Play.

## Despliegue

La arquitectura de despliegue actual es esta:

* `apps/web` se despliega a Firebase Hosting mediante GitHub Actions.
* `apps/api` se despliega a Cloud Run mediante GitHub Actions.
* Artifact Registry almacena la imagen del backend.
* Las reglas de Firestore se despliegan con un workflow dedicado.

### Frontend en Firebase

Variables esperadas por el workflow de frontend (configuradas como variables en GitHub):

* `VITE_FIREBASE_CONFIG`
* `VITE_API_BASE_URL`
* `VITE_GEMINI_MODEL`
* `VITE_DEBUG_MODE`

Secrets requeridos por el workflow:

* `FIREBASE_SERVICE_ACCOUNT_ASCUITA`: clave de la cuenta de servicio de Firebase.

### Backend en Cloud Run

Secrets requeridos por el workflow de backend en GitHub:

* `GCP_WORKLOAD_IDENTITY_PROVIDER`: provider de Workload Identity Federation usado por GitHub Actions.
* `GCP_DEPLOYER_SERVICE_ACCOUNT`: service account que GitHub Actions usará para construir y desplegar.

Variables esperadas en GitHub para el workflow de backend:

* `GCP_PROJECT_ID`, `GCP_REGION`
* `ARTIFACT_REGISTRY_REPOSITORY`
* `CLOUD_RUN_SERVICE`
* `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT`
* `CLOUD_RUN_GEMINI_SECRET`: nombre del secreto de Secret Manager que contiene `GEMINI_API_KEY`
* `FIREBASE_PROJECT_ID`, `GEMINI_MODEL`, `CORS_ORIGIN`

Para la aplicación Android, `CORS_ORIGIN` debe incluir `https://localhost`, que es el origen utilizado por el WebView de Capacitor Android.

En Cloud Run, el backend escucha en `PORT` y usa `HOST=0.0.0.0`. Los logs de seguridad se emiten a Cloud Logging mediante `stdout`, por lo que ya no es necesario persistir `logs/security` en disco. Firebase Admin puede usar la service account adjunta al servicio, evitando guardar `FIREBASE_PRIVATE_KEY` en producción.
El workflow fija en código `CLOUD_RUN_CPU=1`, `CLOUD_RUN_MEMORY=1Gi`, `CLOUD_RUN_CONCURRENCY=80`, `CLOUD_RUN_MIN_INSTANCES=1`, `CLOUD_RUN_MAX_INSTANCES=1` y `CLOUD_RUN_TIMEOUT_SECONDS=3600`. Además, `LOG_LEVEL`, rate limiting, trial gratuito y retención de logs se resuelven directamente desde [`apps/api/src/config.ts`](file:///c:/Users/David/Downloads/Programacion/AI_apps/ascuita/apps/api/src/config.ts).

### Reglas de Firestore

El workflow `deploy-firestore-rules.yml` despliega las reglas definidas en `firestore.rules` cada vez que cambian. Las reglas permiten que cada usuario solo lea y escriba sus propios datos (agentes, conversaciones, mensajes y memorias) bajo `users/{uid}/...`.

Las memorias se almacenan en `users/{uid}/memories/{memoryId}` con una categoría (`preference`, `personal_fact`, `goal` o `context`), contenido breve y marcas de tiempo. Para usuarios registrados están activadas por defecto, aunque pueden desactivarse desde Configuración. Gemini Live puede solicitar guardar o eliminar una memoria mediante function calling, pero el navegador valida la solicitud y Firestore vuelve a comprobar la autorización y el esquema. Los usuarios invitados no reciben estas herramientas ni tienen almacenamiento de memorias.

Importante: `GEMINI_API_KEY` solo debe existir en el backend y nunca en el build del frontend. En producción se recomienda usar Secret Manager para `GEMINI_API_KEY` y Application Default Credentials para Firebase Admin en lugar de guardar una private key.

## Stack Tecnológico

* **Frontend**: React 19, Vite, Three.js, Zustand, Firebase (Auth + Firestore).
* **Backend**: Node.js, Fastify, WebSocket, `@google/genai`, Firebase Admin SDK.
* **Despliegue**: Firebase Hosting (frontend), Cloud Run + Artifact Registry (backend), GitHub Actions (CI/CD).
* **Base de datos**: Cloud Firestore con reglas de seguridad por usuario.

## Aplicación Android

La guía completa de Capacitor, Firebase Android, firma, comandos de APK/AAB y checklist de Play Store está en [docs/mobile-android.md](docs/mobile-android.md).

El `applicationId` Android es `app.ascuita`. Google Play requiere un AAB para nuevas aplicaciones; el APK se usa para pruebas y distribución directa.

## Licencia y Atribución

Este proyecto conserva la licencia Apache 2.0 del código original:

* Código original: Copyright 2024 Google LLC, licenciado bajo Apache License, Version 2.0.
* Modificaciones: publicadas bajo la misma licencia Apache License, Version 2.0.

Consulta [LICENSE](LICENSE) para más detalles.

## Documentos Legales

El Servicio cuenta con los siguientes documentos legales, disponibles tanto en el repositorio como en la web:

| Documento | Archivo | URL pública |
|---|---|---|
| Política de Privacidad (ES) | `docs/privacy-policy-es.md` | `/privacidad` |
| Privacy Policy (EN) | `docs/privacy-policy-en.md` | `/privacy` |
| Términos y Condiciones (ES) | `docs/terms-es.md` | `/terminos` |
| Terms of Service (EN) | `docs/terms-en.md` | `/terms` |
