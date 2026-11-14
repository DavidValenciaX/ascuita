# Gemini y Qwen Realtime

Ascuita utiliza el mismo cliente de audio para ambos proveedores. El navegador habla con el backend mediante un contrato propio; solo los adaptadores del backend conocen el protocolo de Gemini o Qwen. No se migran ni eliminan agentes, preferencias de voz o conversaciones existentes.

## Configurar el proveedor

Variables de `apps/api/.env`:

```dotenv
REALTIME_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-live-preview

QWEN_API_KEY=...
QWEN_WORKSPACE_ID=...
QWEN_MODEL=qwen3.8-omni-flash-realtime
QWEN_VOICE=Tina

WEB_SEARCH_MODEL=gemini-3.5-flash-lite
```

`REALTIME_PROVIDER` admite `gemini` y `qwen`. Si se omite, se utiliza Gemini. Un valor diferente impide arrancar el servidor. La falta de credenciales necesarias hace que `/ready` devuelva 503; `/health` sigue siendo una comprobación de vida. Estas comprobaciones no consultan los modelos ni consumen tokens.

Para activar Qwen, crea una clave y un workspace de **Singapur** en Alibaba Cloud Model Studio. El adaptador construye este endpoint:

```text
wss://{QWEN_WORKSPACE_ID}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model={QWEN_MODEL}
```

La clave, el workspace y el endpoint deben pertenecer a la misma región. El despliegue de Cloud Run puede seguir en su región actual. La latencia desde el usuario debe medirse antes de activar Qwen en producción. Referencia: [conexión de Qwen](https://help.aliyun.com/en/model-studio/realtime).

Con Gemini activo no son necesarias las credenciales de Qwen. Con Qwen activo, `GEMINI_API_KEY` sigue siendo necesaria para las búsquedas y el endpoint legado. Las claves no se incluyen en el frontend, las respuestas de configuración ni los mensajes del protocolo.

Edita el flag y reinicia el backend. En PowerShell también puedes sobrescribirlo para una ejecución:

```powershell
$env:REALTIME_PROVIDER = 'qwen'
npm run dev:api
```

Para volver a Gemini, usa `REALTIME_PROVIDER=gemini` y reinicia o despliega otra revisión. No hace falta reconstruir el frontend. El cambio afecta a las nuevas conexiones; no traslada las sesiones abiertas entre proveedores. Los fallos se comunican y no activan otro proveedor automáticamente.

## Compatibilidad y comportamiento

| Endpoint | Uso |
| --- | --- |
| WebSocket `/live` | APK y navegadores antiguos; siempre utiliza Gemini y conserva sus mensajes actuales. |
| WebSocket `/live/v2` | Cliente actualizado; utiliza el proveedor y modelo definidos en el backend. |
| GET `/live/v2/config` | Metadatos públicos del proveedor seleccionado, capacidades, voz y formato de audio. |

El backend comparte autenticación de Firebase, trial de invitados, límites y leases de Redis, y persistencia de mensajes entre ambos endpoints. Un cliente v2 no puede elegir otro proveedor o modelo enviándolo en su solicitud.

Los contratos se encuentran en `shared/realtime-protocol.d.ts`. Una conexión v2 comienza con:

```json
{
  "type": "connect",
  "payload": {
    "authToken": "firebase-id-token",
    "agentId": "default-agent",
    "agentName": "Ascuita",
    "config": {
      "instructions": "Habla en español.",
      "voice": "Aoede",
      "webSearch": true,
      "tools": []
    }
  }
}
```

`connection.ready` confirma la preparación del transporte. El micrófono se transmite solo después de `session.ready`, que confirma la configuración del modelo. La espera máxima del cliente es de 15 segundos. El audio sigue siendo PCM mono de 16 bits: entrada a 16 kHz y salida a 24 kHz, codificado en Base64.

Con Gemini se conserva la voz de cada agente. Con Qwen se utiliza `QWEN_VOICE` (por defecto `Tina`); los ajustes muestran esa voz sin modificar la preferencia Gemini guardada. Al volver a Gemini se recuperan las voces anteriores.

Las reconexiones Gemini pueden utilizar un handle nativo vinculado al proveedor, modelo, agente y conversación. Qwen reconstruye contexto textual con hasta los últimos 20 mensajes finalizados y 12.000 caracteres, en la memoria del cliente. No se reproducen grabaciones antiguas ni se vuelven a ejecutar herramientas. Esto no recupera el contexto acústico de una sesión anterior ni añade persistencia para invitados. Las sesiones recuperadas no repiten el saludo inicial.

## Memoria y búsqueda web

Las funciones de memoria y edición del agente conservan sus comprobaciones de autenticación, preferencias y confirmación. Las llamadas se identifican y deduplican por `callId`. Los resultados de llamadas canceladas o sesiones cerradas se descartan.

Qwen no permite activar `tools` y `enable_search` simultáneamente. Ascuita mantiene `enable_search=false` y registra `web_search` como una herramienta del servidor junto con las funciones del cliente. Véase la [referencia de eventos](https://help.aliyun.com/en/model-studio/client-events).

`web_search` utiliza `WEB_SEARCH_MODEL` con Google Search mediante Gemini `generateContent`. Cada ejecución tiene un límite de 10 segundos y 1.024 tokens de salida, sin reintentos automáticos. Devuelve un resumen, enlaces y los metadatos de grounding. El frontend muestra las fuentes y las sugerencias de Google en un panel desplegable; el HTML de sugerencias se presenta en un iframe sin permiso para ejecutar scripts.

Si falla la búsqueda, Qwen recibe un resultado de error y conserva la conversación. Las búsquedas puntuales se facturan en Gemini además del consumo de Qwen. Los logs permiten identificar estas llamadas, su duración y sus errores. Gemini Live conserva su búsqueda nativa.

## Pruebas

```powershell
npm test
npm run build
```

Los tests usan transportes simulados y no llaman a los modelos. Para una comprobación real de audio y transcripción de cada adaptador:

```powershell
npm run build:api
node --env-file=apps/api/.env apps/api/scripts/realtime-smoke.mjs gemini
node --env-file=apps/api/.env apps/api/scripts/realtime-smoke.mjs qwen
```

Estos comandos sí realizan solicitudes de pago. Usan una frase de prueba en español y no guardan conversaciones ni memorias. Para la aceptación de producción, probar también desde el navegador: permiso del micrófono, conversación de varios turnos, interrupción, reconexión, guardar/olvidar una memoria con una cuenta de prueba y una búsqueda con sus fuentes visibles.

## Desplegar y revertir

1. Desplegar el backend con `REALTIME_PROVIDER=gemini`. Mantener `/live` para clientes antiguos.
2. Configurar, cuando esté disponible, un secreto de Secret Manager para `QWEN_API_KEY`, dar acceso a la cuenta de ejecución y establecer `CLOUD_RUN_QWEN_SECRET` con su nombre. `QWEN_WORKSPACE_ID`, `QWEN_MODEL`, `QWEN_VOICE`, `WEB_SEARCH_MODEL` y `REALTIME_PROVIDER` son variables del workflow.
3. Publicar el frontend nuevo y actualizar los APK. El workflow de frontend comprueba primero la disponibilidad de `/live/v2/config` y `/ready` para evitar publicarlo contra un backend antiguo.
4. Verificar Qwen con sus credenciales y cambiar `REALTIME_PROVIDER=qwen` en las variables de GitHub; ejecutar el workflow de backend. El frontend y los APK actualizados reciben el cambio sin un nuevo build.
5. Para revertir, desplegar el backend con `REALTIME_PROVIDER=gemini`. Los clientes antiguos siguen utilizando Gemini durante toda la transición.

`VITE_GEMINI_MODEL` ya no se utiliza en builds nuevos. La actualización del modelo Gemini y la retirada de `/live` son tareas separadas.
