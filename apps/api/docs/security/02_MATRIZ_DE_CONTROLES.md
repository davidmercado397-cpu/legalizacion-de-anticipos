# 2. Matriz de controles

Cada control indica su estado y **dónde verificarlo**: archivo de código, prueba automática (se
ejecuta en cada cambio en CI) o reporte en `evidence/`. Referencias:

- **ASVS:** OWASP Application Security Verification Standard 4.0.3, nivel 2. Se cita el capítulo
  (V2 autenticación, V3 sesiones, V4 control de acceso, V5 validación, V7 errores y logs, V8 datos,
  V9 comunicaciones, V10 código malicioso, V12 archivos, V13 API, V14 configuración).
- **ISO:** controles del Anexo A de ISO/IEC 27001:2022. Es una **alineación**: NextByte no tiene
  certificación ISO 27001 (ver brechas en `00_RESUMEN_EJECUTIVO.md`).

Estados: ✅ implementado · 🟡 parcial · 📅 planificado · — no aplica.

## Identidad y autenticación

| # | Control | ASVS | ISO | Estado | Evidencia |
|---|---|---|---|---|---|
| A1 | Contraseñas con Argon2id, longitud mínima 10 | V2.1, V2.4 | 8.5 | ✅ | `app/adapters/outbound/security/passwords.py`; `PASSWORD_MIN_LENGTH` en `app/config.py` |
| A2 | Bloqueo tras 5 intentos fallidos (5 minutos) | V2.2.1 | 8.5 | ✅ | `tests/security/test_authentication.py::test_wrong_password_locks_the_account` |
| A3 | Respuesta idéntica para correo inexistente y contraseña errada (sin enumeración de usuarios) | V2.2, V3 | 8.5 | ✅ | `test_unknown_email_and_wrong_password_look_the_same` |
| A4 | MFA TOTP obligatorio para admin, contabilidad y superadmin; sin MFA activo la API responde 403 `mfa_setup_required` | V2.7, V2.8 | 5.17, 8.5 | ✅ | `app/application/mfa.py`; `tests/security/test_mfa.py::test_privileged_roles_must_enable_mfa_before_using_the_api` |
| A5 | Login en dos pasos: el token de reto MFA no sirve como token de acceso y viceversa | V3.5 | 8.5 | ✅ | `app/adapters/outbound/security/tokens.py` (claim `typ`); `test_mfa_token_and_access_token_are_not_interchangeable` |
| A6 | Un código TOTP no se puede reutilizar (anti-repetición) | V2.8.4 | 8.5 | ✅ | `test_login_with_mfa_needs_a_valid_unused_code` |
| A7 | Semilla MFA cifrada (Fernet) con llave fuera de la BD; códigos de recuperación de un solo uso guardados como HMAC | V2.8, V6.2 | 8.24 | ✅ | `app/adapters/outbound/security/mfa.py`; `MFA_ENCRYPTION_KEY` (fail-fast en `app/config.py`) |
| A8 | Restablecer el MFA de otro usuario solo lo hace un admin, nunca el propio; queda auditado | V2.5 | 5.18 | ✅ | `test_an_admin_resets_someone_elses_mfa_but_not_their_own` |
| A9 | Contraseña temporal obligatoria de cambiar en el primer ingreso | V2.5 | 5.17 | ✅ | `test_temporary_password_must_be_changed_first` |
| A10 | Primer administrador y superadmin solo por CLI (no hay registro abierto) | V2.5 | 5.16 | ✅ | `app/cli.py` (`create-admin`, `create-superadmin`) |
| A11 | SSO corporativo (Microsoft/Google) | V2 | 5.16 | 📅 | Fase posterior a la aprobación |

## Sesiones y tokens

| # | Control | ASVS | ISO | Estado | Evidencia |
|---|---|---|---|---|---|
| S1 | Token de acceso de 15 minutos firmado (HS256, secreto de 32+ bytes con fail-fast) | V3.5 | 8.5 | ✅ | `ACCESS_TOKEN_TTL_SECONDS`, `validate_for_startup` en `app/config.py` |
| S2 | Refresh token opaco, guardado como hash, **rotado en cada uso**; si se reutiliza uno viejo se revoca toda la familia | V3.3, V3.5 | 8.5 | ✅ | `app/application/auth.py`; `test_login_refresh_rotation_and_reuse_detection` |
| S3 | Revocación inmediata al desactivar al usuario o cambiar la contraseña (`token_version`) | V3.3 | 5.18 | ✅ | `test_deactivated_user_loses_access_immediately` |
| S4 | Tokens alterados, vencidos o ausentes → 401 | V3.5 | 8.5 | ✅ | `test_tampered_or_missing_tokens_are_rejected` |

## Control de acceso

| # | Control | ASVS | ISO | Estado | Evidencia |
|---|---|---|---|---|---|
| C1 | RBAC: mapa rol → permisos en el dominio; cada endpoint exige su permiso (403) | V4.1 | 5.15, 8.3 | ✅ | `app/domain/permissions.py`; `test_role_permissions_return_403` |
| C2 | Anti-IDOR: un registro fuera de la visibilidad del usuario responde 404 (no se confirma que existe), también entre compañías | V4.2 | 8.3 | ✅ | `app/application/access.py`; `tests/security/test_access_and_input.py::test_records_of_another_company_are_invisible_to_accounting` |
| C3 | Segregación de funciones: nadie aprueba su propio anticipo ni revisa su propia legalización, tampoco por WhatsApp | V4.1 | 5.3 | ✅ | `tests/integration/test_admin_and_advances.py::test_advance_flow_with_segregation_of_duties`; `tests/integration/test_whatsapp_flow.py::test_approver_approves_from_whatsapp_but_not_their_own` |
| C3a | Cada paso tiene su rol: el jefe aprueba la solicitud, tesorería entrega y liquida la diferencia, contabilidad revisa y cierra la legalización; ninguno hace el paso del otro | V4.1 | 5.3 | ✅ | `app/domain/permissions.py`; `tests/security/test_access_and_input.py::test_each_step_belongs_to_its_role` |
| C3b | Suplencias con vigencia: el suplente aprueba solo mientras dura; la auditoría registra `on_behalf_of` | V4.1 | 5.3, 5.18 | ✅ | `app/application/access.py`; `tests/integration/test_legalization.py::test_a_substitute_approves_only_while_the_delegation_lasts` |
| C4 | El superadmin (NextByte) solo gestiona la configuración del sistema y ve agregados de uso y costo de la IA (`/usage`, `/ai-costs`): **no ve gastos, anticipos ni datos personales de Forsa** | V4.1 | 5.15, 5.34 | ✅ | `tests/integration/test_settings.py::test_superadmin_has_no_access_to_forsa_data` |
| C5 | Solo el superadmin cambia la configuración del sistema; cada cambio queda auditado con antes y después | V4.1, V7 | 8.9, 8.32 | ✅ | `test_only_the_superadmin_sees_and_changes_settings` |
| C6 | Los controles de seguridad base (TTL de tokens, bloqueo, límites, tamaño de archivo) **no son editables desde la app**: viven en el entorno, así un admin comprometido no puede debilitarlos | V14.1 | 8.9 | ✅ | `app/config.py` frente a `app/application/settings.py` |
| C7 | Límites de peticiones compartidos entre procesos (Redis): login 5/min, MFA 5/min, API 120/min, subidas 30/min, WhatsApp por remitente | V2.2, V11 | 8.6 | ✅ | `RATE_LIMIT_*` en `app/config.py`; `test_login_rate_limit`; `test_whatsapp_flood_is_rate_limited` |

## WhatsApp

| # | Control | ASVS | ISO | Estado | Evidencia |
|---|---|---|---|---|---|
| W1 | Firma HMAC-SHA256 de Meta verificada sobre el cuerpo crudo, en tiempo constante; sin firma válida → 403 (solo se omite en desarrollo sin secreto) | V13.1, V9 | 8.20 | ✅ | `app/adapters/inbound/whatsapp/signature.py`; `tests/unit/test_whatsapp_parser.py::test_signature_is_checked_over_raw_bytes`; `test_webhook_handshake_and_signature` |
| W2 | Tamaño máximo del cuerpo del webhook (413) | V13.1 | 8.20 | ✅ | `WEBHOOK_MAX_BODY_BYTES`; `app/adapters/inbound/http/routers/webhook.py` |
| W3 | Idempotencia: un evento repetido por Meta se procesa una sola vez | V11 | 8.20 | ✅ | `test_duplicate_webhook_is_processed_once` |
| W4 | Un número no registrado no crea nada (ni descarga el archivo ni gasta IA) y **no recibe información** de la empresa | V4, V8 | 5.34 | ✅ | `test_unknown_number_gets_no_expense_and_a_contact_request` |
| W5 | Vinculación por identificador de Meta (BSUID) confirmada por el propio usuario; el nombre de usuario de WhatsApp nunca se usa como identidad | V2 | 5.16 | ✅ | `app/application/whatsapp_identity.py` |
| W6 | La respuesta de un formulario (WhatsApp Flow) solo actúa con un token firmado, vigente (`FLOW_TOKEN_TTL_MINUTES`) y emitido para quien responde; en el chat cada quien abre formularios solo de sus propios gastos | V3, V4 | 5.15, 8.5 | ✅ | `app/application/whatsapp_flows.py`; `tests/security/test_whatsapp_flows.py`; `tests/unit/test_whatsapp_client.py::test_flow_token_carries_who_what_and_expires` |

## Archivos y datos

| # | Control | ASVS | ISO | Estado | Evidencia |
|---|---|---|---|---|---|
| D1 | Tipo de archivo por contenido (firma binaria), no por nombre ni cabecera; tamaño máximo; límite de píxeles contra imágenes bomba | V12.1, V12.2 | 8.7 | ✅ | `app/domain/files.py`; `Image.MAX_IMAGE_PIXELS` en `app/adapters/outbound/documents.py`; `test_files_are_validated_by_content_not_by_name` |
| D2 | Bucket R2 privado; la API firma una URL de 5 minutos solo después de autorizar | V12.4, V8 | 8.3, 8.24 | ✅ | `app/adapters/outbound/storage.py`; `SIGNED_URL_TTL_SECONDS` |
| D3 | Cifrado en tránsito (HTTPS hacia la API y hacia Meta, R2 y OpenRouter) y HSTS en producción | V9.1 | 8.24 | ✅ | `app/main.py` (cabecera `Strict-Transport-Security`) |
| D4 | Cifrado en reposo de la base de datos y de R2 | V8 | 8.24 | 🟡 | R2 cifra en reposo por defecto (ver `03_SUBPROCESADORES.md`); el cifrado del disco de PostgreSQL depende del hosting y se confirma al desplegar |
| D5 | La IA recibe solo la imagen y el contexto mínimo de la compañía, sin nombres, correos ni teléfonos; OpenRouter con `data_collection=deny` y retención cero activa por defecto (solo endpoints sin retención, p. ej. Gemini en Vertex) | V8.3 | 5.34, 8.11 | ✅ | `app/adapters/outbound/openrouter.py` (bloque `provider`); llave `ai.zero_data_retention` |
| D6b | Integridad del aprendizaje: lo que corrige un empleado no se aplica hasta que lo valida su aprobador, nadie valida lo suyo y quitar un concepto bloqueado deja un hallazgo para el aprobador | V4.1 | 5.3, 8.28 | ✅ | `app/application/learning.py`; `tests/integration/test_learning.py::test_the_employee_cannot_teach_without_validation` |
| D6 | La respuesta de la IA es dato no confiable: esquema JSON estricto, verificaciones determinísticas y confirmación del usuario; la IA no ejecuta acciones | V5.2 | 8.28 | ✅ | `app/domain/verification.py`; `app/application/reading.py` |
| D7 | Retención de soportes 10 años y supresión de datos personales no contables | V8.3 | 5.33, 8.10 | 🟡 | Supresión del contacto de usuarios retirados: `POST /employees/{id}/anonymize-contact` (`tests/integration/test_legalization.py::test_contact_data_of_a_retired_user_can_be_erased`). La retención de 10 años es política (`04_PROTECCION_DE_DATOS.md`): no hay borrado automático |

## Auditoría, errores y registros

| # | Control | ASVS | ISO | Estado | Evidencia |
|---|---|---|---|---|---|
| L1 | Auditoría de eventos de seguridad y de negocio (login, MFA, roles, aprobaciones, correcciones, configuración) | V7.1 | 8.15 | ✅ | `audit_log`; `GET /api/v1/audit` con filtros (`app/application/audit.py`) |
| L2 | Auditoría **inmutable**: trigger que bloquea UPDATE, DELETE y TRUNCATE, más permisos de BD que no los conceden a la aplicación | V7.3 | 8.15 | ✅ | `alembic/versions/0004_mfa_and_append_only_audit.py`; `tests/security/test_audit.py`; `evidence/db_least_privilege.txt` |
| L3 | Los logs no contienen contraseñas, tokens ni teléfonos completos (prueba automática sobre los logs de la suite) | V7.1.1 | 8.11, 8.15 | ✅ | `test_logs_never_contain_passwords_tokens_or_full_phone_numbers` |
| L4 | Errores sin trazas internas; formato estándar con `request_id` para correlacionar con el log | V7.4 | 8.15 | ✅ | `app/adapters/inbound/http/errors.py`; `tests/integration/test_api_contract.py` |
| L5 | Cabeceras de seguridad (`nosniff`, `DENY`, `no-referrer`, HSTS) y CORS con lista permitida | V14.4 | 8.23 | ✅ | `app/main.py`; `test_security_headers` |
| L6 | Monitoreo y alertas 24/7 | V7 | 8.16 | 📅 | Brecha declarada (ver resumen ejecutivo) |

## Infraestructura y base de datos

| # | Control | ASVS | ISO | Estado | Evidencia |
|---|---|---|---|---|---|
| I1 | Mínimo privilegio en BD: la aplicación usa un rol sin DDL; las migraciones usan otro | V14.1 | 8.2, 8.18 | ✅ | `scripts/db_roles.sql`; `MIGRATION_DATABASE_URL`; `evidence/db_least_privilege.txt` |
| I2 | Configuración insegura impide arrancar (secreto JWT corto, llave MFA o Redis ausentes) | V14.1 | 8.9 | ✅ | `Settings.validate_for_startup` |
| I3 | Integración sin configurar → 503 claro y `/ready` lo reporta (nunca un modo inseguro silencioso) | V14 | 8.9 | ✅ | `tests/integration/test_integrations.py` |
| I4 | Contenedor sin privilegios; `/docs` desactivable en producción | V14.1 | 8.9 | ✅ | `Dockerfile` (usuario `app`); `ENABLE_DOCS` |
| I5 | Respaldo diario con verificación de integridad y prueba de restauración | — | 8.13 | 🟡 | `scripts/backup_db.sh`, `scripts/restore_drill.sh`, `evidence/restore_drill.txt`; falta programarlo en producción (ver `06_CONTINUIDAD_RESPALDOS.md`) |

## Desarrollo seguro

| # | Control | ASVS | ISO | Estado | Evidencia |
|---|---|---|---|---|---|
| P1 | Análisis estático de seguridad (bandit), 0 hallazgos | V10, V14.2 | 8.28 | ✅ | `evidence/bandit.json` |
| P2 | Vulnerabilidades conocidas en dependencias (pip-audit), 0 hallazgos; versiones fijadas | V14.2 | 8.8 | ✅ | `evidence/pip-audit.json`; `requirements.txt` |
| P3 | Búsqueda de secretos en el historial (gitleaks) en cada cambio | V14.2 | 8.4 | ✅ | `.github/workflows/ci.yml` (job `security`) |
| P4 | Inventario de componentes (SBOM CycloneDX) | V14.2 | 5.9, 8.8 | ✅ | `evidence/sbom.cdx.json` |
| P5 | Arquitectura verificada automáticamente (el dominio no depende de frameworks ni proveedores) | V1 | 8.27 | ✅ | `evidence/import-linter.txt` |
| P6 | Tipado estático, código sin uso y dependencias sin uso vigilados en CI | V10 | 8.25, 8.28 | ✅ | `evidence/mypy.txt`, `evidence/vulture.txt`, `evidence/deptry.txt` |
| P7 | Cobertura mínima de pruebas del 85 % (la suite falla por debajo) | V1 | 8.29 | ✅ | `evidence/coverage.json`, `evidence/tests.xml` |
| P8 | Prueba de penetración externa | V1 | 8.29 | 📅 | Recomendada antes de producción (brecha declarada) |
| P9 | Escaneo dinámico (OWASP ZAP baseline) contra staging | V14 | 8.29 | 📅 | Cuando exista el ambiente de staging |

## Cómo regenerar la evidencia

```bash
TEST_DATABASE_URL=postgresql+asyncpg://... ./scripts/security_evidence.sh
```

Genera de nuevo los reportes de `evidence/` con la fecha (`generated_at.txt`) y el commit
(`commit.txt`) sobre los que se ejecutaron. CI hace lo mismo en cada cambio y publica los reportes
como artefacto descargable.
