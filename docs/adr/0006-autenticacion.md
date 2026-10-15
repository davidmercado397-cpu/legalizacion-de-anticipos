# ADR-0006: Autenticación local con puerta abierta a Microsoft 365

- Estado: Aceptada (implementación en la iteración 2)

## Decisión
- Usuarios locales creados por un administrador. Contraseñas con argon2id. Access token JWT de corta duración + refresh token rotativo.
- La identidad del usuario se separa de la credencial (tabla `identidades_externas`), para enlazar después una cuenta de Entra ID (OIDC) sin migrar usuarios.
- Iteración 1: guard de desarrollo con la cabecera `x-usuario-id`, **prohibido en producción** (la app no arranca con `AUTH_MODE=dev` y `NODE_ENV=production`).
