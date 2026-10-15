CREATE TABLE "huellas_comprobante" (
	"comprobante_id" text PRIMARY KEY NOT NULL,
	"viajero_id" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"hash_perceptual" char(16),
	"clave_fiscal_tipo" text,
	"clave_fiscal" text,
	"emisor_id" text,
	"numero_documento" text,
	"fecha" date,
	"total" numeric(18, 2),
	"moneda" char(3),
	"vigente" boolean DEFAULT true NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credenciales" (
	"usuario_id" text PRIMARY KEY NOT NULL,
	"hash_contrasena" text NOT NULL,
	"actualizada_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"usuario_id" text NOT NULL,
	"familia_id" uuid NOT NULL,
	"hash_token" text NOT NULL,
	"expira_en" timestamp with time zone NOT NULL,
	"revocada_en" timestamp with time zone,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sesiones_hash_token_unique" UNIQUE("hash_token")
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"email" text NOT NULL,
	"cargo_id" text NOT NULL,
	"jefe_inmediato_id" text,
	"jefe_directivo_id" text,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuarios_no_autojefe" CHECK ("usuarios"."jefe_inmediato_id" IS DISTINCT FROM "usuarios"."id")
);
--> statement-breakpoint
CREATE TABLE "configuracion_escalamiento" (
	"tipo" text PRIMARY KEY NOT NULL,
	"activa" boolean NOT NULL,
	"parametros" jsonb NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solicitud_destinos" (
	"solicitud_id" uuid NOT NULL,
	"orden" integer NOT NULL,
	"pais_codigo" char(2) NOT NULL,
	"ciudad" text NOT NULL,
	"fecha_inicio" date NOT NULL,
	"fecha_fin" date NOT NULL,
	CONSTRAINT "solicitud_destinos_solicitud_id_orden_pk" PRIMARY KEY("solicitud_id","orden")
);
--> statement-breakpoint
CREATE TABLE "solicitud_lineas" (
	"solicitud_id" uuid NOT NULL,
	"orden" integer NOT NULL,
	"destino_indice" integer NOT NULL,
	"pais_codigo" char(2) NOT NULL,
	"concepto_codigo" text NOT NULL,
	"concepto_nombre" text NOT NULL,
	"unidad" text NOT NULL,
	"cantidad" integer NOT NULL,
	"tarifa_id" text NOT NULL,
	"tarifa_unitaria" numeric(18, 2) NOT NULL,
	"valor_unitario_solicitado" numeric(18, 2) NOT NULL,
	"moneda" char(3) NOT NULL,
	CONSTRAINT "solicitud_lineas_solicitud_id_orden_pk" PRIMARY KEY("solicitud_id","orden")
);
--> statement-breakpoint
CREATE TABLE "solicitud_pasos_aprobacion" (
	"solicitud_id" uuid NOT NULL,
	"orden" integer NOT NULL,
	"nivel" text NOT NULL,
	"aprobador_id" text NOT NULL,
	"estado" text NOT NULL,
	"decidido_en" timestamp with time zone,
	"comentario" text,
	CONSTRAINT "solicitud_pasos_aprobacion_solicitud_id_orden_pk" PRIMARY KEY("solicitud_id","orden")
);
--> statement-breakpoint
CREATE TABLE "solicitudes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"viajero_id" text NOT NULL,
	"motivo" text NOT NULL,
	"justificacion" text,
	"estado" text NOT NULL,
	"moneda_anticipo" char(3) NOT NULL,
	"total_anticipo" numeric(18, 2) NOT NULL,
	"tasas" jsonb NOT NULL,
	"requiere_jefe_directivo" boolean NOT NULL,
	"motivos_escalamiento" jsonb NOT NULL,
	"creada_en" timestamp with time zone NOT NULL,
	"actualizada_en" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "solicitudes_estado_ck" CHECK ("solicitudes"."estado" IN ('EN_APROBACION', 'APROBADA', 'RECHAZADA', 'CANCELADA'))
);
--> statement-breakpoint
CREATE TABLE "conceptos_viatico" (
	"codigo" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"unidad" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "conceptos_unidad_ck" CHECK ("conceptos_viatico"."unidad" IN ('NOCHE', 'DIA'))
);
--> statement-breakpoint
CREATE TABLE "tarifas" (
	"id" text PRIMARY KEY NOT NULL,
	"cargo_id" text NOT NULL,
	"pais_codigo" char(2) NOT NULL,
	"concepto_codigo" text NOT NULL,
	"valor" numeric(18, 2) NOT NULL,
	"moneda" char(3) NOT NULL,
	"vigente_desde" date NOT NULL,
	"vigente_hasta" date,
	CONSTRAINT "tarifas_valor_ck" CHECK ("tarifas"."valor" >= 0),
	CONSTRAINT "tarifas_vigencia_ck" CHECK ("tarifas"."vigente_hasta" IS NULL OR "tarifas"."vigente_hasta" >= "tarifas"."vigente_desde")
);
--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_jefe_inmediato_id_usuarios_id_fk" FOREIGN KEY ("jefe_inmediato_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_jefe_directivo_id_usuarios_id_fk" FOREIGN KEY ("jefe_directivo_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitud_destinos" ADD CONSTRAINT "solicitud_destinos_solicitud_id_solicitudes_id_fk" FOREIGN KEY ("solicitud_id") REFERENCES "public"."solicitudes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitud_lineas" ADD CONSTRAINT "solicitud_lineas_solicitud_id_solicitudes_id_fk" FOREIGN KEY ("solicitud_id") REFERENCES "public"."solicitudes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitud_pasos_aprobacion" ADD CONSTRAINT "solicitud_pasos_aprobacion_solicitud_id_solicitudes_id_fk" FOREIGN KEY ("solicitud_id") REFERENCES "public"."solicitudes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_concepto_codigo_conceptos_viatico_codigo_fk" FOREIGN KEY ("concepto_codigo") REFERENCES "public"."conceptos_viatico"("codigo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "huellas_sha256_vigente_uq" ON "huellas_comprobante" USING btree ("sha256") WHERE "huellas_comprobante"."vigente";--> statement-breakpoint
CREATE UNIQUE INDEX "huellas_clave_fiscal_vigente_uq" ON "huellas_comprobante" USING btree ("clave_fiscal") WHERE "huellas_comprobante"."vigente" AND "huellas_comprobante"."clave_fiscal" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "huellas_emisor_numero_vigente_uq" ON "huellas_comprobante" USING btree ("emisor_id","numero_documento") WHERE "huellas_comprobante"."vigente" AND "huellas_comprobante"."emisor_id" IS NOT NULL AND "huellas_comprobante"."numero_documento" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "huellas_emisor_fecha_idx" ON "huellas_comprobante" USING btree ("emisor_id","fecha") WHERE "huellas_comprobante"."vigente";--> statement-breakpoint
CREATE INDEX "sesiones_usuario_idx" ON "sesiones" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "sesiones_familia_idx" ON "sesiones" USING btree ("familia_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_uq" ON "usuarios" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "usuarios_jefe_inmediato_idx" ON "usuarios" USING btree ("jefe_inmediato_id");--> statement-breakpoint
CREATE INDEX "pasos_aprobador_pendiente_idx" ON "solicitud_pasos_aprobacion" USING btree ("aprobador_id") WHERE "solicitud_pasos_aprobacion"."estado" = 'PENDIENTE';--> statement-breakpoint
CREATE INDEX "solicitudes_viajero_idx" ON "solicitudes" USING btree ("viajero_id","creada_en");--> statement-breakpoint
CREATE INDEX "tarifas_cargo_pais_idx" ON "tarifas" USING btree ("cargo_id","pais_codigo");