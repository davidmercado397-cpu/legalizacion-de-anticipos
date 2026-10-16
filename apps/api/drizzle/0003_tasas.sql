CREATE TABLE "cotizaciones_dolar" (
	"moneda" char(3) NOT NULL,
	"fecha" date NOT NULL,
	"por_dolar" numeric(20, 8) NOT NULL,
	"fecha_publicada" date NOT NULL,
	"fuente" text NOT NULL,
	"consultada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cotizaciones_dolar_moneda_fecha_pk" PRIMARY KEY("moneda","fecha")
);
