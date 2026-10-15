# ADR-0006: Autenticación local con puerta abierta a Microsoft 365

- Estado: Aceptada e implementada (iteración 2)

## Decisión
- Usuarios locales creados por un administrador. Contraseñas con argon2id. Access token JWT de corta duración + refresh token rotativo.
- La identidad del usuario se separa de la credencial (tabla `identidades_externas`), para enlazar después una cuenta de Entra ID (OIDC) sin migrar usuarios.
- La web recibe el refresh token en una cookie `httpOnly; SameSite=Strict`; la app móvil lo recibe en el cuerpo (cabecera `x-cliente: movil`).
- Reutilizar un refresh token ya usado revoca toda la familia de sesiones (detección de robo).
- Modo `AUTH_MODE=dev` (cabecera `x-usuario-id`) solo para pruebas; **prohibido en producción** (la app no arranca).
