# Ascuita para Android

La aplicación Android se genera desde `apps/web` con Capacitor. El identificador permanente de la aplicación es `app.ascuita`.

## Requisitos locales

- Node.js 20 o superior.
- Android Studio y Android SDK compatibles con Capacitor 8.
- JDK 21, requerido por la toolchain Android generada por Capacitor 8.
- Una cuenta Firebase con Google Authentication y Firestore habilitados.

## Configuración local

Comprueba que Gradle use JDK 21. En PowerShell puedes seleccionar una
instalación local para la sesión actual:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
java -version
```

1. Instala las dependencias desde la raíz:

   ```bash
   npm ci
   ```

2. Crea las variables del build móvil:

   ```powershell
   Copy-Item apps/web/.env.mobile.example apps/web/.env.mobile
   ```

   Edita `apps/web/.env.mobile` con la configuración pública de Firebase y la URL HTTPS del backend. Las variables `VITE_*` se incorporan al bundle; nunca pongas allí `GEMINI_API_KEY` ni credenciales de Firebase Admin.

3. En Firebase Console registra una aplicación Android con el paquete `app.ascuita`. Descarga `google-services.json` en `apps/web/android/app/google-services.json` y añade las huellas SHA-1 y SHA-256 de debug, de la upload key y de Play App Signing. El archivo local está ignorado por Git.

4. En Firebase Authentication habilita el proveedor Google. La aplicación usa autenticación nativa en Android y sincroniza la credencial con el SDK Web.

5. En la configuración del backend, define `CORS_ORIGIN` incluyendo la web pública y el origen Android Capacitor:

   ```env
   CORS_ORIGIN=https://ascuita.web.app,https://localhost
   ```

## Comandos

Desde la raíz del repositorio:

```bash
# Compila la web móvil y sincroniza los assets/plugins nativos
npm run mobile:sync

# Abre el proyecto Android en Android Studio
npm run mobile:open

# APK debug instalable para emulador o dispositivo
npm run mobile:apk

# APK release firmado si existe android/keystore.properties
npm run mobile:apk:release

# AAB release firmado para Google Play
npm run mobile:aab
```

Los artefactos se generan en:

- `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`
- `apps/web/android/app/build/outputs/apk/release/app-release.apk`
- `apps/web/android/app/build/outputs/bundle/release/app-release.aab`

Google Play utiliza el AAB para nuevas aplicaciones. El APK se conserva para pruebas locales, distribución directa o validación de una release.

El proyecto generado contiene los iconos y splash iniciales de Capacitor como
placeholder técnico. Antes de publicar, reemplázalos por los assets oficiales
de Ascuita y regenera `android/app/src/main/res`.

## Firma release

Genera una upload key fuera del repositorio y guárdala en un lugar seguro:

```powershell
keytool -genkeypair -v `
  -keystore C:\secure\ascuita-upload.jks `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -alias ascuita-upload
```

Copia `apps/web/android/keystore.properties.example` como `keystore.properties` y reemplaza sus valores. El archivo y el keystore están excluidos de Git. No pierdas la upload key: Play App Signing protege la clave de distribución, pero las futuras subidas necesitan esta clave.

El `versionCode` debe aumentar en cada subida. Se puede pasar al wrapper Gradle:

```powershell
cd apps/web/android
.\gradlew.bat bundleRelease -PVERSION_CODE=1 -PVERSION_NAME=1.0.0
```

Para publicar, sube el AAB al canal Internal testing antes de producción, completa Play App Signing y registra en Firebase la huella de la clave de firma de Google Play.

## Build en GitHub Actions

El workflow `.github/workflows/build-android.yml` se ejecuta manualmente o al
crear un tag `v*`. Configura estas variables de repositorio:

- `VITE_API_BASE_URL`
- `VITE_FIREBASE_CONFIG`
- `VITE_GEMINI_MODEL`
- `ANDROID_VERSION_NAME` opcional

Y estos secrets:

- `FIREBASE_ANDROID_CONFIG_BASE64`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

El workflow publica el APK release y el AAB como artifacts de GitHub; la
subida a Play Console se mantiene manual para revisar primero Internal testing.

## Eliminación de cuenta

- Desde Settings, el usuario autenticado puede eliminar la cuenta y todos los datos.
- La URL externa para Play Console es `https://ascuita.web.app/eliminar-cuenta`.
- El endpoint `DELETE /account` solo acepta un Firebase ID token válido y usa Firebase Admin para eliminar recursivamente los datos de `users/{uid}` y la cuenta Auth.

## Validación antes de publicar

Prueba en un dispositivo físico:

- Google Sign-In nativo y persistencia de sesión.
- Permiso `RECORD_AUDIO`, denegación y revocación.
- AudioWorklet, reproducción PCM y reconexión WebSocket.
- Avatar Three.js y consumo de memoria/batería.
- Agentes, conversaciones, mensajes y memorias en Firestore.
- Exportaciones mediante el diálogo nativo de compartir.
- Eliminación de cuenta, políticas legales y retorno desde segundo plano.

En Play Console prepara también la ficha, capturas de teléfono, URL de privacidad, URL de eliminación, Data safety, clasificación de contenido, declaración del micrófono y credenciales de prueba.
