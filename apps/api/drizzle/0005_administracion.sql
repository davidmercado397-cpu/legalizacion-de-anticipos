CREATE TABLE "cargos" (
	"codigo" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "empresas" (
	"id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"nit" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
-- Datos existentes: la empresa principal toma el NIT que estaba en la política, y los cargos en uso se registran.
INSERT INTO "empresas" ("id", "nombre", "nit")
SELECT 'emp-principal', 'Empresa principal',
       COALESCE((SELECT split_part(regexp_replace("nit_empresa", '[\s.]', '', 'g'), '-', 1) FROM "politica_legalizacion" WHERE "id" = 1), '900123456')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "cargos" ("codigo", "nombre")
SELECT DISTINCT "cargo_id", initcap(lower(replace("cargo_id", '_', ' ')))
FROM (SELECT "cargo_id" FROM "usuarios" UNION SELECT "cargo_id" FROM "tarifas") AS en_uso
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "empresa_id" text DEFAULT 'emp-principal' NOT NULL;--> statement-breakpoint
ALTER TABLE "configuracion_escalamiento" ADD COLUMN "actualizado_por" text;--> statement-breakpoint
CREATE UNIQUE INDEX "empresas_nit_uq" ON "empresas" USING btree ("nit");--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "politica_legalizacion" DROP COLUMN "nit_empresa";