# Solventa · microservicio `suscripciones`

ISIS-2212 Arquitecturas de software robustas · Grupo 1 · Sprint 2

**Responsabilidad:** Evaluación de riesgo, orquestación del cobro de prima (`ms-terceros`) y expedición síncrona de póliza (`ms-emision`) con Bulkhead HTTP dedicado (`undici`) y timeout estricto de 1500 ms.

| | |
|---|---|
| Nodo de despliegue | Cluster EKS detrás de balanceador interno |
| Llama a | terceros (`POST /pagos/cobros`), emision (`POST /polizas`) |
| Lo llaman | distribucion (`POST /suscripciones`) |
| Base de datos | BD Suscripciones (PostgreSQL, Database-per-Service) |
| Puerto interno | 3000 |
| Origen en el monolito | `src/modules/suscripcion` + `DistribucionService.suscribirYEmitir` |

## Correr en local

```bash
cp .env.example .env
npm ci
npm run start:dev
```

## Correr en local con Docker

```bash
docker compose -f docker-compose.local.yml up -d --build
curl localhost:3002/health
docker compose -f docker-compose.local.yml down
```

## Tácticas de Disponibilidad (ASR Suscripción y Emisión Resiliente)

- **Bulkhead (`src/clients/emision.client.ts`)**: Pool HTTP `undici.Agent` aislado exclusivamente para `ms-emision` (`BULKHEAD_CONEXIONES=20`) + control de concurrencia máxima en vuelo (`BULKHEAD_CONCURRENCIA=30`) para evitar el agotamiento de recursos si `ms-emision` se degrada.
- **Timeout estricto de 1500 ms**: `EMISION_TIMEOUT_MS=1500` aplicado con `AbortSignal.timeout`.
- **Failover idempotente**: Envía `suscripcionId` y `X-Idempotency-Key` a `ms-emision`; si una réplica corta el socket o devuelve `502`/`503` durante un Rolling Update o terminación forzada, reintenta dentro del presupuesto de 1500 ms hacia el balanceador interno.
- **Sondas `@nestjs/terminus`**: `GET /health/liveness`, `GET /health/readiness` (`SELECT 1`) y `GET /health`.

## API

- `POST /suscripciones` — Requiere header `X-Socio-Id` (UUID) y body `{ cotizacionId, clienteId, documento, primaMensual, sumaAsegurada }`. Devuelve `201 Created` con `{ suscripcionId, estado, puntajeRiesgo, polizaId, numeroPoliza, estadoPoliza, fechaInicioVigencia, fechaFinVigencia, cotizacionId, clienteId }`.
- `GET /suscripciones` — Lista suscripciones (filtro opcional `?clienteId=`).
- `GET /suscripciones/:id` — Obtiene una suscripción por UUID.
- `GET /metricas` — Contadores de peticiones, rechazos Bulkhead, timeouts y reintentos exitosos.
