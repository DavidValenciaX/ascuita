# Procedimiento de eliminación de datos de usuario

La eliminación de una cuenta solicitada a `contacto@davidvalencia.site` debe eliminar
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
