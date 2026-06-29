# Política de Privacidad de Ascuita

**Última actualización: 28 de junio de 2026**

Esta Política de Privacidad describe cómo Ascuita ("el Servicio", "nosotros", "nos") recopila, utiliza y protege la información personal de los usuarios ("tú", "el Usuario") al utilizar la aplicación web Ascuita.

El responsable del tratamiento de datos personales es **David Valencia**, con domicilio digital de contacto en **contacto@davidvalencia.site**.

Al crear una cuenta o utilizar el Servicio, aceptas las prácticas descritas en esta Política de Privacidad.

---

## 1. Información que recopilamos

### 1.1. Información de autenticación

Cuando inicias sesión con tu cuenta de Google a través de Firebase Authentication, recopilamos y almacenamos:

- **Dirección de correo electrónico**
- **Nombre para mostrar** (display name) de tu cuenta de Google
- **URL de tu foto de perfil** de Google
- **Estado de verificación de correo**
- **Proveedor de autenticación** (Google)

### 1.2. Contenido generado por el usuario

Al utilizar el Servicio, puedes crear y almacenar:

- **Agentes personalizados**: nombre, personalidad, color del cuerpo y voz seleccionada.
- **Conversaciones**: registro de las conversaciones mantenidas con los agentes de IA, incluyendo el identificador del agente, fecha de inicio y fin, y número de mensajes.
- **Mensajes**: texto transcrito de tus mensajes (entrada de voz transcrita automáticamente) y las respuestas del agente de IA.

### 1.3. Datos de audio en tiempo real

El Servicio transmite tu voz en tiempo real al backend, que la reenvía a la API de Google Gemini Live para generar respuestas. Este audio **no se almacena permanentemente** en nuestros servidores; se procesa de forma transitoria durante la sesión activa y se descarta al finalizar.

### 1.4. Datos técnicos y de uso

- **Dirección IP**: utilizada para seguridad, rate limiting y prevención de abuso. Se almacena temporalmente en los logs de seguridad con una retención configurable (por defecto, 3 días).
- **Datos de analítica**: Firebase Analytics recopila datos agregados y anonimizados sobre el uso del Servicio (eventos, sesiones, dispositivo, navegador, ubicación aproximada).
- **Headers HTTP estándar**: tipo de navegador, sistema operativo, idioma preferido.

### 1.5. Datos de usuarios no autenticados (trial gratuito)

Si utilizas el Servicio sin iniciar sesión, recopilamos:

- **Dirección IP**: para controlar la duración del trial gratuito (3 minutos por defecto) y prevenir abuso.
- **Audio en tiempo real**: transmitido a Gemini Live API de la misma forma que los usuarios autenticados.

No se almacena contenido de conversaciones para usuarios no autenticados.

---

## 2. Cómo utilizamos tu información

Utilizamos la información recopilada para:

- **Proporcionar el Servicio**: autenticar usuarios, guardar y recuperar conversaciones y agentes, y procesar interacciones con IA.
- **Mejorar el Servicio**: analizar patrones de uso mediante Firebase Analytics para identificar áreas de mejora.
- **Garantizar la seguridad**: prevenir abuso, aplicar rate limiting, detectar y bloquear IPs maliciosas, y mantener logs de seguridad.
- **Comunicarnos contigo**: responder consultas, notificar cambios importantes en el Servicio o en esta Política.

No vendemos, alquilamos ni comercializamos tu información personal con terceros.

---

## 3. Base legal del tratamiento (GDPR)

Para usuarios en la Unión Europea, el tratamiento de datos se basa en:

- **Consentimiento** (Art. 6(1)(a) GDPR): al iniciar sesión con Google y aceptar esta Política.
- **Ejecución de un contrato** (Art. 6(1)(b) GDPR): para proporcionar la funcionalidad del Servicio.
- **Interés legítimo** (Art. 6(1)(f) GDPR): para seguridad, prevención de abuso y analítica.

---

## 4. Compartir información con terceros

Compartimos datos con los siguientes proveedores de servicios, bajo sus respectivas políticas de privacidad:

### 4.1. Google Firebase

- **Firebase Authentication**: gestiona la autenticación con Google.
- **Cloud Firestore**: almacena los datos de usuarios, agentes, conversaciones y mensajes.
- **Firebase Analytics**: recopila datos de uso agregados.
- Política de privacidad de Google: [https://policies.google.com/privacy](https://policies.google.com/privacy)

### 4.2. Google Gemini Live API

- Procesa el audio y texto en tiempo real para generar las respuestas de los agentes de IA.
- Los datos enviados a Gemini se rigen por la política de privacidad de Google Cloud.
- Política de Gemini: [https://ai.google.dev/privacy](https://ai.google.dev/privacy)

### 4.3. Proveedor de hosting del backend

- El backend está alojado en una VPS que procesa las conexiones WebSocket.
- La dirección IP del usuario se procesa en el servidor para seguridad y rate limiting.

No compartimos información personal con ningún otro tercero, salvo obligación legal.

---

## 5. Retención de datos

| Tipo de dato | Período de retención |
|---|---|
| Cuenta de usuario (Auth) | Hasta que el usuario solicite su eliminación |
| Agentes personalizados | Hasta que el usuario los elimine o solicite la eliminación de la cuenta |
| Conversaciones y mensajes | Hasta que el usuario los elimine o solicite la eliminación de la cuenta |
| Logs de seguridad (IP) | 3 días (configurable, por defecto) |
| Datos de trial gratuito (IP) | 1 hora tras el inicio del trial |
| Datos de analítica | Según la política de retención de Firebase Analytics |

Puedes solicitar la eliminación de todos tus datos en cualquier momento escribiendo a **contacto@davidvalencia.site**.

---

## 6. Tus derechos (GDPR y CCPA)

Si resides en la Unión Europea (GDPR) o California (CCPA), tienes los siguientes derechos:

- **Acceso**: solicitar una copia de tus datos personales.
- **Rectificación**: solicitar la corrección de datos inexactos.
- **Supresión**: solicitar la eliminación de tus datos personales ("derecho al olvido").
- **Limitación**: solicitar que limitemos el tratamiento de tus datos.
- **Portabilidad**: recibir tus datos en un formato estructizado y transferible.
- **Oposición**: oponerte al tratamiento de tus datos basado en interés legítimo.
- **Retirada del consentimiento**: en cualquier momento, sin afectar la legalidad del tratamiento previo.

Para ejercer estos derechos, escribe a **contacto@davidvalencia.site**.

---

## 7. Seguridad

Implementamos las siguientes medidas de seguridad:

- **API key protegida**: la clave de Gemini Live API nunca se expone al navegador; el backend actúa como proxy.
- **Rate limiting**: límites de peticiones HTTP, conexiones WebSocket, conexiones concurrentes por IP, y bytes de audio por ventana de tiempo.
- **Bloqueo temporal de IPs abusivas**: IPs que exceden los límites son bloqueadas temporalmente.
- **Headers de seguridad**: nosniff, DENY frame, strict referrer policy, same-site CORP, restricción de permisos de micrófono.
- **Verificación de tokens**: el backend verifica los tokens de Firebase Auth antes de permitir acceso a datos.
- **Reglas de Firestore**: cada usuario solo puede acceder a sus propios datos.

A pesar de estas medidas, ningún sistema es 100% seguro. No podemos garantizar la seguridad absoluta de tus datos.

---

## 8. Transferencias internacionales

Tus datos se procesan en servidores de Google (Firebase, Gemini) y en una VPS que puede estar ubicada fuera de tu país de residencia. Al utilizar el Servicio, aceptas la transferencia internacional de tus datos según las condiciones de los proveedores de servicios.

Google participa en marcos de transferencia de datos como el EU-U.S. Data Privacy Framework.

---

## 9. Cookies y tecnologías similares

El Servicio utiliza Firebase Analytics, que puede emplear cookies o almacenamiento local para recopilar datos de uso. Puedes gestionar las cookies desde la configuración de tu navegador.

No utilizamos cookies de publicidad ni de seguimiento de terceros.

---

## 10. Privacidad de menores

El Servicio está dirigido a personas de **13 años o más**. No recopilamos deliberadamente información personal de menores de 13 años.

Si eres padre o tutor y crees que un menor de 13 años ha proporcionado datos personales, contáctanos en **contacto@davidvalencia.site** para eliminar dicha información.

---

## 11. Enlaces a sitios de terceros

El Servicio puede contener enlaces a sitios web de terceros. No somos responsables de las prácticas de privacidad de dichos sitios. Te recomendamos revisar sus políticas de privacidad.

---

## 12. Cambios en esta Política de Privacidad

Podemos actualizar esta Política de Privacidad en cualquier momento. Notificaremos cambios significativos mediante un aviso en el Servicio o por correo electrónico. La fecha de "Última actualización" en la parte superior indica la versión vigente.

---

## 13. Contacto

Para cualquier pregunta, solicitud o ejercicio de derechos sobre esta Política de Privacidad, contacta a:

- **Email**: contacto@davidvalencia.site
- **Responsable**: David Valencia

---

*Al utilizar Ascuita, confirmas que has leído y aceptado esta Política de Privacidad.*
