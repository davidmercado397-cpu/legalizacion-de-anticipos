CREATE TABLE "cruces_extracto" (
	"movimiento_id" uuid PRIMARY KEY NOT NULL,
	"extracto_id" uuid NOT NULL,
	"soporte_id" uuid NOT NULL,
	"legalizacion_id" uuid NOT NULL,
	"puntaje" numeric(4, 3),
	"estado" text NOT NULL,
	"monto_soporte" numeric(20, 4),
	"decidido_por" text,
	"decidido_en" timestamp with time zone,
	CONSTRAINT "cruces_extracto_soporte_id_unique" UNIQUE("soporte_id")
);
--> statement-breakpoint
CREATE TABLE "extractos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"titular_id" text NOT NULL,
	"legalizacion_id" uuid NOT NULL,
	"ultimos4" char(4),
	"moneda" char(3) NOT NULL,
	"archivo_nombre" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"perfil" jsonb NOT NULL,
	"rechazos" jsonb NOT NULL,
	"cargado_por" text NOT NULL,
	"cargado_en" timestamp with time zone NOT NULL,
	"actualizado_en" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "extractos_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "movimientos_extracto" (
	"id" uuid PRIMARY KEY NOT NULL,
	"extracto_id" uuid NOT NULL,
	"fila" integer NOT NULL,
	"fecha" date NOT NULL,
	"descripcion" text NOT NULL,
	"referencia" text,
	"valor" numeric(20, 4) NOT NULL,
	"tipo" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perfiles_extracto" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"perfil" jsonb NOT NULL,
	"actualizado_por" text NOT NULL,
	"actualizado_en" timestamp with time zone NOT NULL,
	CONSTRAINT "perfiles_extracto_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
ALTER TABLE "cruces_extracto" ADD CONSTRAINT "cruces_extracto_movimiento_id_movimientos_extracto_id_fk" FOREIGN KEY ("movimiento_id") REFERENCES "public"."movimientos_extracto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cruces_extracto" ADD CONSTRAINT "cruces_extracto_extracto_id_extractos_id_fk" FOREIGN KEY ("extracto_id") REFERENCES "public"."extractos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_extracto" ADD CONSTRAINT "movimientos_extracto_extracto_id_extractos_id_fk" FOREIGN KEY ("extracto_id") REFERENCES "public"."extractos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cruces_extracto_idx" ON "cruces_extracto" USING btree ("extracto_id");--> statement-breakpoint
CREATE INDEX "extractos_titular_idx" ON "extractos" USING btree ("titular_id");--> statement-breakpoint
CREATE INDEX "movimientos_extracto_idx" ON "movimientos_extracto" USING btree ("extracto_id");