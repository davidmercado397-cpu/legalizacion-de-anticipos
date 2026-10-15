CREATE TABLE "anticipos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"solicitud_id" uuid NOT NULL,
	"viajero_id" text NOT NULL,
	"monto" numeric(18, 2) NOT NULL,
	"moneda" char(3) NOT NULL,
	"viaje" jsonb NOT NULL,
	"estado" text NOT NULL,
	"erp_referencia" text,
	"erp_ultimo_error" text,
	"erp_intentos" integer DEFAULT 0 NOT NULL,
	"desembolso_fecha" date,
	"desembolso_medio" text,
	"desembolso_referencia" text,
	"desembolsado_por" text,
	"desembolsado_en" timestamp with time zone,
	"creado_en" timestamp with time zone NOT NULL,
	"actualizado_en" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "anticipos_solicitud_id_unique" UNIQUE("solicitud_id"),
	CONSTRAINT "anticipos_estado_ck" CHECK ("anticipos"."estado" IN ('PENDIENTE_ERP', 'POR_DESEMBOLSAR', 'DESEMBOLSADO', 'LEGALIZADO')),
	CONSTRAINT "anticipos_monto_ck" CHECK ("anticipos"."monto" > 0)
);
--> statement-breakpoint
CREATE INDEX "anticipos_viajero_idx" ON "anticipos" USING btree ("viajero_id");--> statement-breakpoint
CREATE INDEX "anticipos_estado_idx" ON "anticipos" USING btree ("estado");