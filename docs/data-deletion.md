# Procedimiento de eliminación de datos de usuario

Los usuarios autenticados pueden iniciar la eliminación desde Configuración en la
aplicación web o Android. También existe una página externa para iniciar el
proceso sin instalar la app:

- https://ascuita.web.app/eliminar-cuenta

La aplicación envía un `DELETE /account` con el Firebase ID token. El backend
verifica que el token sea válido, elimina las subcolecciones y elimina la cuenta
de Firebase Authentication. La operación solo puede actuar sobre el UID del
token recibido.

La eliminación manual de una cuenta solicitada a `contacto@davidvalencia.site` debe eliminar
todos los datos bajo `users/{uid}`. Firestore no elimina automáticamente las
subcolecciones cuando se elimina el documento padre.

El operador debe verificar la identidad del solicitante y eliminar, en este orden
o mediante una operación administrativa equivalente:

1. `users/{uid}/agents`
2. `users/{uid}/conversations/{conversationId}/messages`
3. `users/{uid}/conversations`
4. `users/{uid}/memories`
5. El documento `users/{uid}`
6. La cuenta correspondiente de Firebase Authentication, si la solicitud también
   pide eliminar la cuenta.

Después se debe comprobar que no quedan documentos en las subcolecciones y
registrar la fecha de finalización de la solicitud. Este procedimiento requiere
credenciales administrativas y no debe exponerse desde el cliente ni desde una
ruta pública de la API.

La opción **Eliminar todas las memorias** de Configuración solo afecta a la
subcolección `memories`; no elimina conversaciones, agentes ni la cuenta.
