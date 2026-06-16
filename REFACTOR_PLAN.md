# Plan De Refactorizacion

Este archivo sirve como guia operativa para separar `frontend` y `backend` sin exponer secretos y sin perder la capacidad de despliegue actual. Cada casilla puede marcarse a medida que se complete el trabajo.

## Fase 0. Preparacion

- [x] Confirmar que la clave expuesta de Gemini ha sido revocada y reemplazada.
- [x] Confirmar dominio y subdominio finales.
- [ ] Confirmar acceso SSH automatizable a la VPS desde GitHub Actions.
- [ ] Confirmar version de Node en local, CI y VPS.
- [x] Confirmar estrategia de ramas y despliegue a produccion.

Notas:
- Frontend final confirmado en `ascuita.web.app`.
- API confirmada en `https://ascuita-api.duckdns.org/`. VPS actual: `149.130.181.250`.
- Sistema de la VPS confirmado: Ubuntu 24.04.3 LTS ARM64.
- Node confirmado en local y VPS: `v22.20.0`.
- Pendiente dejar fijada la version de Node en CI con `actions/setup-node`.
- Nginx y Certbot ya estan configurados en la VPS.

## Fase 1. Convertir El Repo A Monorepo

- [x] Crear `apps/web` para alojar el frontend actual.
- [x] Crear `package.json` raiz con `workspaces`.
- [x] Mover el frontend actual a `apps/web`.
- [x] Ajustar `tsconfig`, `vite`, rutas y aliases para la nueva ubicacion.
- [x] Ajustar `firebase.json` para publicar `apps/web/dist`.
- [x] Ajustar el workflow actual de Firebase para construir desde `apps/web`.
- [x] Verificar que `npm run build:web` funciona.

## Fase 2. Crear El Backend

- [x] Crear `apps/api`.
- [x] Inicializar backend con Node 20, Fastify y WebSocket.
- [x] Crear endpoint `GET /health`.
- [x] Crear endpoint `WS /live`.
- [x] Definir variables de entorno del backend.
- [x] Preparar estructura de logs y manejo de errores.
- [x] Preparar `pm2` con `ecosystem.config.cjs`.

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
