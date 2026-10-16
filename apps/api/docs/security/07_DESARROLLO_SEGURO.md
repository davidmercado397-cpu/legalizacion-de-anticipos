# 7. Desarrollo seguro

## Ciclo de un cambio

1. **Rama por cambio.** Nada se escribe directo en la rama principal.
2. **Revisión.** Cada cambio pasa por un *pull request* revisado antes de integrarse.
3. **CI obligatoria** (`.github/workflows/ci.yml`). Si un paso falla, el cambio no se integra.
4. **Staging antes de producción.** Primero se despliega en un ambiente aparte, con su propia base
   de datos, su propio bucket y un número de prueba de WhatsApp. Después pasa a producción.
5. **Respaldo antes de migrar.** Un despliegue con cambios de esquema respalda la base de datos de
   producción antes de aplicarlos.

## Qué verifica la CI en cada cambio

| Verificación | Herramienta | Falla si… |
|---|---|---|
| Estilo y errores comunes | ruff | hay errores de lint o de formato |
| Tipos | mypy | hay inconsistencias de tipos |
| Arquitectura | import-linter | el dominio importa frameworks, o la aplicación importa adaptadores |
| Código y dependencias sin uso | vulture, deptry | queda código muerto o una dependencia sin usar |
| Pruebas (incluidas las de seguridad de `tests/security/`) | pytest contra PostgreSQL real | falla alguna prueba o la cobertura baja del 85 % |
| Migraciones | Alembic | no suben en una base vacía o no coinciden con el modelo |
| Secretos en el historial | gitleaks | se encuentra una credencial en cualquier commit |
| Vulnerabilidades en dependencias | pip-audit | alguna dependencia tiene una vulnerabilidad conocida |
| Análisis estático de seguridad | bandit | hay hallazgos |
| Inventario de componentes | CycloneDX | — (genera el SBOM) |

Los reportes se publican como artefacto en cada ejecución (`security-evidence`). La copia con fecha
está en `docs/security/evidence/`.

**Excepciones documentadas:**

- Bandit omite B101 (`assert`). Solo aparece en las pruebas, que no se despliegan.
- Hay una marca `nosec B105` sobre el catálogo de mensajes al usuario que mencionan la contraseña
  (`_PASSWORD_MESSAGES` en `app/application/messages.py`). Son textos, no credenciales.

## Dependencias

- Versiones **fijadas** en `requirements.txt`, para que cada build sea reproducible.
- Una alerta de pip-audit se atiende actualizando la versión. Ejemplo: `pypdf` y `PyJWT` se
  actualizaron el 16/10/2026 por avisos publicados.
- Se revisan cada mes y ante cada aviso de seguridad.

## Gestión de secretos

| Secreto | Dónde vive | Rotación |
|---|---|---|
| `JWT_SECRET` (firma de tokens) | Gestor de secretos del hosting | Cada 6 meses, o de inmediato ante sospecha. Rotarlo cierra todas las sesiones |
| `MFA_ENCRYPTION_KEY` (cifra las semillas MFA) | Gestor de secretos del hosting | Solo ante sospecha. Rotarla exige reiniciar el MFA de los usuarios (procedimiento con aviso previo) |
| Contraseñas de los roles de BD | Gestor de secretos | Anual, o al salir alguien del equipo con acceso |
| Token de WhatsApp, secreto de la app de Meta | Gestor de secretos | Anual, o ante sospecha (desde el panel de Meta) |
| Llave de OpenRouter | Gestor de secretos | Anual, o ante sospecha. Lleva límite de gasto |
| Llaves de R2 | Gestor de secretos | Anual. Con permisos solo sobre el bucket de la aplicación |
| Llave de cifrado de respaldos | Gestor de secretos, con una copia fuera de línea | Anual |

Reglas:

- **Nunca en el repositorio.** `.env` está en `.gitignore` y gitleaks lo vigila.
- **Nunca en los logs.** Lo comprueba una prueba automática.
- **Distintos por ambiente.** Staging y producción no comparten ningún secreto.
- **Fail-fast.** Sin un secreto obligatorio, o con uno débil, la aplicación no arranca.

## Accesos del equipo

- El acceso a producción (hosting, base de datos, paneles de Meta, Cloudflare y OpenRouter) se
  limita a las personas que lo necesitan, con MFA en cada panel.
- El rol superadmin de la aplicación no ve datos de Forsa (ver control C4 de la matriz).
- Al salir alguien del equipo: se revocan sus accesos y se rotan los secretos que conocía.
