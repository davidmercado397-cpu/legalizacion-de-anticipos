ALTER TABLE "extractos" ADD COLUMN "decisiones_cargos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "legalizaciones" ADD COLUMN "descuentos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "soportes" ADD COLUMN "cargo_bancario" jsonb;