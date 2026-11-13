--
-- BD Suscripciones · esquema del microservicio suscripciones.
-- Extraido de database/solventa.sql del monolito modular.
-- Las llaves foraneas hacia clientes y cotizaciones NO se replican:
-- esas tablas viven en ms-identidad y ms-cotizacion (Database-per-Service).
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

DO $$
BEGIN
    CREATE TYPE public.suscripciones_estado_enum AS ENUM (
        'ASISTIDA',
        'ACEPTADA',
        'RECHAZADA',
        'AJUSTADA'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.suscripciones (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    estado public.suscripciones_estado_enum NOT NULL,
    "puntajeRiesgo" integer NOT NULL,
    "fechaEvaluacion" timestamp without time zone DEFAULT now() NOT NULL,
    "clienteId" uuid,
    "cotizacionId" uuid,
    CONSTRAINT "PK_bdaed0a0504c9786d45b786a68a" PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS "IDX_suscripciones_clienteId"
    ON public.suscripciones ("clienteId");

CREATE INDEX IF NOT EXISTS "IDX_suscripciones_cotizacionId"
    ON public.suscripciones ("cotizacionId");
