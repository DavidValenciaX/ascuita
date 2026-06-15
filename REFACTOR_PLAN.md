# Plan De Refactorizacion

Este archivo sirve como guia operativa para separar `frontend` y `backend` sin exponer secretos y sin perder la capacidad de despliegue actual. Cada casilla puede marcarse a medida que se complete el trabajo.

## Fase 0. Preparacion

- [ ] Confirmar que la clave expuesta de Gemini ha sido revocada y reemplazada.
- [ ] Confirmar dominio y subdominio finales.
- [ ] Confirmar acceso SSH automatizable a la VPS desde GitHub Actions.
- [ ] Confirmar version de Node en local, CI y VPS.
- [ ] Confirmar estrategia de ramas y despliegue a produccion.

## Fase 1. Convertir El Repo A Monorepo

- [x] Crear `apps/web` para alojar el frontend actual.
- [x] Crear `package.json` raiz con `workspaces`.
- [x] Mover el frontend actual a `apps/web`.
- [x] Ajustar `tsconfig`, `vite`, rutas y aliases para la nueva ubicacion.
- [x] Ajustar `firebase.json` para publicar `apps/web/dist`.
- [x] Ajustar el workflow actual de Firebase para construir desde `apps/web`.
- [x] Verificar que `npm run build:web` funciona.

## Fase 2. Crear El Backend

- [ ] Crear `apps/api`.
- [ ] Inicializar backend con Node 20, Fastify y WebSocket.
- [ ] Crear endpoint `GET /health`.
- [ ] Crear endpoint `WS /live`.
- [ ] Definir variables de entorno del backend.
- [ ] Preparar estructura de logs y manejo de errores.
- [ ] Preparar `pm2` con `ecosystem.config.cjs`.

## Fase 3. Mover La Integracion Con Gemini

- [ ] Eliminar el uso de `GEMINI_API_KEY` del frontend.
- [ ] Eliminar la inyeccion de secretos desde Vite.
- [ ] Mover la conexion real a Gemini Live al backend.
- [ ] Crear un cliente WebSocket propio en el frontend para hablar con el backend.
- [ ] Adaptar `LiveAPIContext` y `use-live-api` al nuevo cliente.
- [ ] Validar streaming de audio, texto y eventos.

## Fase 4. Seguridad

- [ ] Guardar `GEMINI_API_KEY` solo en la VPS.
- [ ] Configurar CORS para permitir solo el dominio del frontend.
- [ ] Validar cabeceras de proxy y soporte WebSocket en Nginx.
- [ ] Añadir rate limiting o protecciones basicas si hace falta.
- [ ] Revisar logs para no exponer datos sensibles.

## Fase 5. Despliegue

- [ ] Crear `deploy-frontend.yml`.
- [ ] Crear `deploy-backend.yml`.
- [ ] Mantener despliegues separados por cambios de ruta.
- [ ] Configurar Nginx como reverse proxy de `api.tudominio.com`.
- [ ] Configurar `pm2` para arranque automatico.
- [ ] Documentar el proceso de despliegue manual y automatico.

## Fase 6. Verificacion Final

- [ ] Probar frontend en Firebase con backend remoto.
- [ ] Probar reconexion WebSocket y errores de red.
- [ ] Probar reinicio del backend con `pm2`.
- [ ] Confirmar que el bundle del frontend no contiene `GEMINI_API_KEY`.
- [ ] Revocar definitivamente cualquier credencial anterior comprometida.
- [ ] Actualizar `README.md` con la nueva arquitectura.

## Notas De Seguimiento

- [ ] Mantener este archivo actualizado al cerrar cada fase.
- [ ] Registrar decisiones tecnicas importantes al lado del paso afectado.
- [ ] Si un cambio queda parcial, dejar una nota breve con estado y siguiente accion.
