import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent, fetch } from 'undici';

const TIMEOUT_SIN_TACTICAS_MS = 5000;

export interface DatosEmision {
  cotizacionId: string;
  clienteId: string;
  suscripcionId: string;
}

export interface PolizaEmitida {
  id: string;
  numeroPoliza: string;
  estado: string;
  fechaInicioVigencia: string;
  fechaFinVigencia: string;
  clienteId: string | null;
  cotizacionId: string | null;
  suscripcionId?: string | null;
}

/**
 * Cliente HTTP hacia ms-emision con patron Bulkhead (pool de conexiones
 * dedicado en undici + tope de concurrencia), timeout estricto de 1500 ms y
 * reintento idempotente ante corte de replica durante Rolling Update o kill.
 */
@Injectable()
export class EmisionClient implements OnModuleDestroy {
  private readonly logger = new Logger(EmisionClient.name);
  private readonly poolEmision: Agent;
  private readonly resilienciaHabilitada: boolean;
  private readonly timeoutMs: number;
  private readonly maxConcurrencia: number;
  private readonly reintentos: number;

  private enVuelo = 0;
  private fallosEmision = 0;
  private timeoutsEmision = 0;
  private rechazosBulkhead = 0;
  private reintentosExitosos = 0;

  constructor(private readonly config: ConfigService) {
    this.resilienciaHabilitada =
      this.config.get<string>('RESILIENCIA_HABILITADA', 'true') === 'true';

    this.timeoutMs = this.resilienciaHabilitada
      ? Number(this.config.get<string>('EMISION_TIMEOUT_MS', '1500'))
      : TIMEOUT_SIN_TACTICAS_MS;

    const conexiones = this.resilienciaHabilitada
      ? Number(this.config.get<string>('BULKHEAD_CONEXIONES', '20'))
      : 100;

    this.maxConcurrencia = Number(
      this.config.get<string>('BULKHEAD_CONCURRENCIA', '30'),
    );

    this.reintentos = this.resilienciaHabilitada
      ? Number(this.config.get<string>('EMISION_REINTENTOS', '1'))
      : 0;

    this.poolEmision = new Agent({
      connections: conexiones,
      pipelining: 1,
      keepAliveTimeout: 10_000,
      keepAliveMaxTimeout: 30_000,
      connect: {
        timeout: this.timeoutMs,
      },
    });
  }

  async emitirPoliza(
    datos: DatosEmision,
    socioId?: string,
  ): Promise<PolizaEmitida> {
    const baseUrl = this.config.get<string>('EMISION_URL');
    if (!baseUrl) {
      this.logger.error('Falta la variable de entorno EMISION_URL');
      throw new ServiceUnavailableException('Emisión no disponible');
    }

    if (this.resilienciaHabilitada && this.enVuelo >= this.maxConcurrencia) {
      this.rechazosBulkhead++;
      this.fallosEmision++;
      this.logger.warn(
        `Bulkhead hacia Emision saturado (enVuelo=${this.enVuelo}/${this.maxConcurrencia})`,
      );
      throw new ServiceUnavailableException(
        'Emisión no disponible (Bulkhead saturado)',
      );
    }

    this.enVuelo++;
    const deadline = Date.now() + this.timeoutMs;
    const maxIntentos = 1 + this.reintentos;

    try {
      for (let intento = 1; intento <= maxIntentos; intento++) {
        const restanteMs = deadline - Date.now();
        if (restanteMs <= 20) {
          this.timeoutsEmision++;
          this.fallosEmision++;
          throw new ServiceUnavailableException(
            'Emisión no disponible (timeout)',
          );
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': datos.suscripcionId,
        };
        if (socioId) {
          headers['X-Socio-Id'] = socioId;
        }

        let respuesta: Awaited<ReturnType<typeof fetch>>;
        try {
          respuesta = await fetch(`${baseUrl}/polizas`, {
            method: 'POST',
            headers,
            body: JSON.stringify(datos),
            signal: AbortSignal.timeout(restanteMs),
            dispatcher: this.poolEmision,
          });
        } catch (error) {
          const esTimeout = this.esErrorTimeout(error);
          if (esTimeout) {
            this.timeoutsEmision++;
            this.fallosEmision++;
            this.logger.warn(
              `Emision supero el timeout de ${this.timeoutMs} ms: ${String(error)}`,
            );
            throw new ServiceUnavailableException(
              'Emisión no disponible (timeout)',
            );
          }

          const puedeReintentar =
            this.resilienciaHabilitada &&
            intento < maxIntentos &&
            deadline - Date.now() > 50;

          this.logger.warn(
            `Error de conexion hacia Emision (intento ${intento}/${maxIntentos}): ${String(error)}`,
          );

          if (puedeReintentar) {
            continue;
          }

          this.fallosEmision++;
          throw new ServiceUnavailableException('Emisión no disponible');
        }

        if (respuesta.status === 502 || respuesta.status === 503) {
          await respuesta.text().catch(() => undefined);
          const puedeReintentar =
            this.resilienciaHabilitada &&
            intento < maxIntentos &&
            deadline - Date.now() > 50;

          this.logger.warn(
            `Emision respondio ${respuesta.status} (intento ${intento}/${maxIntentos})`,
          );

          if (puedeReintentar) {
            continue;
          }

          this.fallosEmision++;
          throw new ServiceUnavailableException('Emisión no disponible');
        }

        if (respuesta.status >= 500) {
          await respuesta.text().catch(() => undefined);
          this.fallosEmision++;
          this.logger.error(`Emision respondio ${respuesta.status}`);
          throw new ServiceUnavailableException('Emisión no disponible');
        }

        if (!respuesta.ok) {
          const mensaje = await this.leerMensaje(respuesta);
          throw new HttpException(mensaje, respuesta.status);
        }

        if (intento > 1) {
          this.reintentosExitosos++;
        }

        return (await respuesta.json()) as PolizaEmitida;
      }

      this.fallosEmision++;
      throw new ServiceUnavailableException('Emisión no disponible');
    } finally {
      this.enVuelo--;
    }
  }

  obtenerMetricas() {
    return {
      resilienciaHabilitada: this.resilienciaHabilitada,
      timeoutMs: this.timeoutMs,
      maxConcurrencia: this.maxConcurrencia,
      enVueloEmision: this.enVuelo,
      fallosEmision: this.fallosEmision,
      timeoutsEmision: this.timeoutsEmision,
      rechazosBulkhead: this.rechazosBulkhead,
      reintentosExitosos: this.reintentosExitosos,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.poolEmision.close();
  }

  private esErrorTimeout(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const err = error as { name?: string; code?: string };
      return (
        err.name === 'TimeoutError' ||
        err.name === 'AbortError' ||
        err.code === 'UND_ERR_HEADERS_TIMEOUT' ||
        err.code === 'UND_ERR_BODY_TIMEOUT'
      );
    }
    return false;
  }

  private async leerMensaje(
    respuesta: Awaited<ReturnType<typeof fetch>>,
  ): Promise<string> {
    try {
      const cuerpo = (await respuesta.json()) as {
        message?: string | string[];
      };
      if (Array.isArray(cuerpo.message)) {
        return cuerpo.message.join('; ');
      }
      if (typeof cuerpo.message === 'string') {
        return cuerpo.message;
      }
    } catch {
      // Cuerpo vacio o no JSON.
    }
    return `Respuesta ${respuesta.status}`;
  }
}
