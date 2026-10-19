"""Configuración por entorno: solo secretos, infraestructura y controles de seguridad base.

Los parámetros funcionales (modelos de IA, plantillas, umbrales, valores por defecto de negocio) viven en
la tabla system_settings y los administra el superadmin; no se agregan aquí."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_ENV: str = "development"  # development | staging | production
    LOG_LEVEL: str = "INFO"
    ENABLE_DOCS: bool = True
    CORS_ORIGINS: str = ""  # lista permitida, separada por comas
    API_PREFIX: str = "/api/v1"

    # --- Base de datos ---
    DATABASE_URL: str = "postgresql+asyncpg://gastos:gastos@localhost:5432/gastos"
    # Rol con permisos de DDL, solo para migraciones (ver scripts/db_roles.sql). Vacío = DATABASE_URL.
    MIGRATION_DATABASE_URL: str = ""
    DB_POOL_SIZE: int = 10

    # --- Autenticación ---
    JWT_SECRET: str = ""
    ACCESS_TOKEN_TTL_SECONDS: int = 900
    REFRESH_TOKEN_TTL_DAYS: int = 30
    PASSWORD_MIN_LENGTH: int = 10
    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_LOCK_MINUTES: int = 5
    LINK_CODE_TTL_MINUTES: int = 15
    # Doble factor: obligatorio para estos roles; la llave cifra la semilla TOTP en la BD.
    # Generar con: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    MFA_ENCRYPTION_KEY: str = ""
    MFA_REQUIRED_ROLES: str = "admin,accountant,treasury,superadmin"
    MFA_ISSUER: str = "nextv.ia"  # nombre con el que aparece en la app de autenticación
    MFA_CHALLENGE_TTL_SECONDS: int = 300
    FLOW_TOKEN_TTL_MINUTES: int = 30  # vigencia de un formulario (WhatsApp Flow) abierto
    MFA_RECOVERY_CODES: int = 10

    # --- Redis (límites de peticiones, caché compartida entre workers) ---
    REDIS_URL: str = ""

    # --- Límites de peticiones ---
    RATE_LIMIT_LOGIN: str = "5/minute"
    RATE_LIMIT_REFRESH: str = "30/minute"
    RATE_LIMIT_MFA: str = "5/minute"
    RATE_LIMIT_API: str = "120/minute"
    RATE_LIMIT_UPLOAD: str = "30/minute"
    RATE_LIMIT_WA_MEDIA: str = "30/minute"
    RATE_LIMIT_WA_MESSAGES: str = "60/minute"
    RATE_LIMIT_LINK_CODE: str = "5/hour"
    RATE_LIMIT_WA_UNKNOWN: str = "3/hour"  # respuestas a números no registrados (evita bucles con otros bots)
    RATE_LIMIT_WA_NOTICE: str = "1/minute"  # aviso de "vas muy rápido"

    # --- WhatsApp (Meta Cloud API) ---
    WHATSAPP_VERIFY_TOKEN: str = ""
    WHATSAPP_APP_SECRET: str = ""
    WHATSAPP_ACCESS_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    GRAPH_API_VERSION: str = "v24.0"
    WEBHOOK_MAX_BODY_BYTES: int = 1_000_000

    # --- IA (OpenRouter) ---
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"
    OPENROUTER_TIMEOUT_SECONDS: float = 25.0

    # --- Almacenamiento (Cloudflare R2, compatible con S3) ---
    R2_ENDPOINT_URL: str = ""
    R2_BUCKET: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_REGION: str = "auto"
    # Dirección con la que el navegador abre las URLs firmadas, si es otra (desarrollo con MinIO en
    # Docker: la API llega por "minio:9000" y el navegador por "localhost:9000"). Vacío = R2_ENDPOINT_URL.
    R2_PUBLIC_ENDPOINT_URL: str = ""
    SIGNED_URL_TTL_SECONDS: int = 300
    MAX_UPLOAD_BYTES: int = 15 * 1024 * 1024

    # --- Procesamiento ---
    EXPENSE_MAX_ATTEMPTS: int = 3
    EXPENSE_PROCESSING_CONCURRENCY: int = 5
    SWEEPER_INTERVAL_SECONDS: float = 60.0
    SWEEPER_STALE_SECONDS: int = 300

    # --- Tasas de cambio (fuentes públicas, sin llave) ---
    TRM_API_URL: str = "https://www.datos.gov.co/resource/32sa-8pi3.json"  # TRM oficial (Superfinanciera)
    ECB_API_URL: str = "https://api.frankfurter.dev/v1"  # tasas de referencia del BCE vía Frankfurter
    EXCHANGE_RATES_SYNC_SECONDS: float = 21600.0
    LEGALIZATION_REMINDERS_SECONDS: float = 3600.0
    WHATSAPP_SESSIONS_SWEEP_SECONDS: float = 60.0

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def r2_configured(self) -> bool:
        return bool(self.R2_BUCKET and self.R2_ENDPOINT_URL and self.R2_ACCESS_KEY_ID and self.R2_SECRET_ACCESS_KEY)

    @property
    def whatsapp_configured(self) -> bool:
        return bool(self.WHATSAPP_ACCESS_TOKEN and self.WHATSAPP_PHONE_NUMBER_ID)

    @property
    def openrouter_configured(self) -> bool:
        return bool(self.OPENROUTER_API_KEY)

    @property
    def mfa_required_roles(self) -> frozenset[str]:
        return frozenset(r.strip() for r in self.MFA_REQUIRED_ROLES.split(",") if r.strip())

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    def validate_for_startup(self) -> None:
        """Falla al arrancar si la configuración es insegura, en vez de correr medio protegida."""
        if len(self.JWT_SECRET.encode()) < 32:
            raise RuntimeError("JWT_SECRET must be at least 32 bytes")
        if len(self.MFA_ENCRYPTION_KEY) != 44:
            raise RuntimeError("MFA_ENCRYPTION_KEY is required (a Fernet key, 44 characters)")
        if not self.REDIS_URL.startswith(("redis://", "rediss://")):
            raise RuntimeError("REDIS_URL is required (redis://host:6379/0): rate limits and caches are shared through it")


@lru_cache
def get_settings() -> Settings:
    return Settings()
