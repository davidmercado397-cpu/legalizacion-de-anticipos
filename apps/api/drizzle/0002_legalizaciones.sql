CREATE TABLE "legalizaciones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"anticipo_id" uuid NOT NULL,
	"viajero_id" text NOT NULL,
	"monto" numeric(18, 2) NOT NULL,
	"moneda" char(3) NOT NULL,
	"viaje_inicio" date NOT NULL,
	"viaje_fin" date NOT NULL,
	"estado" text NOT NULL,
	"historial" jsonb NOT NULL,
	"creada_en" timestamp with time zone NOT NULL,
	"actualizada_en" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "legalizaciones_anticipo_id_unique" UNIQUE("anticipo_id"),
	CONSTRAINT "legalizaciones_estado_ck" CHECK ("legalizaciones"."estado" IN ('ABIERTA', 'EN_REVISION', 'DEVUELTA', 'APROBADA'))
);
--> statement-breakpoint
CREATE TABLE "politica_legalizacion" (
	"id" integer PRIMARY KEY NOT NULL,
	"nit_empresa" text NOT NULL,
	"topes_recibo_caja" jsonb NOT NULL,
	"exclusiones" jsonb NOT NULL,
	"actualizada_por" text,
	"actualizada_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "soportes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"legalizacion_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"estado" text NOT NULL,
	"descripcion" text NOT NULL,
	"archivo" jsonb,
	"extraccion" jsonb,
	"datos" jsonb,
	"alertas" jsonb NOT NULL,
	"decision" jsonb,
	"beneficiario" text,
	"creado_en" timestamp with time zone NOT NULL,
	"actualizado_en" timestamp with time zone NOT NULL,
	CONSTRAINT "soportes_tipo_ck" CHECK ("soportes"."tipo" IN ('FACTURA', 'RECIBO_CAJA'))
);
--> statement-breakpoint
ALTER TABLE "soportes" ADD CONSTRAINT "soportes_legalizacion_id_legalizaciones_id_fk" FOREIGN KEY ("legalizacion_id") REFERENCES "public"."legalizaciones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legalizaciones_estado_idx" ON "legalizaciones" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "soportes_legalizacion_idx" ON "soportes" USING btree ("legalizacion_id");--> statement-breakpoint
CREATE INDEX "soportes_procesando_idx" ON "soportes" USING btree ("estado") WHERE "soportes"."estado" = 'PROCESANDO';