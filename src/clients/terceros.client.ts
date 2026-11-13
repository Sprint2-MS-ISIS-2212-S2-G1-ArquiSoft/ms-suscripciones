import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent, fetch } from 'undici';

interface RespuestaCobro {
  exitoso: boolean;
}

@Injectable()
export class TercerosClient implements OnModuleDestroy {
  private readonly logger = new Logger(TercerosClient.name);
  private readonly poolTerceros: Agent;
  private readonly timeoutMs: number;
  private readonly pagosHabilitado: boolean;

  constructor(private readonly config: ConfigService) {
    this.pagosHabilitado =
      this.config.get<string>('PAGOS_HABILITADO', 'true') === 'true';
    this.timeoutMs = Number(
      this.config.get<string>('TERCEROS_TIMEOUT_MS', '1500'),
    );
    this.poolTerceros = new Agent({
      connections: 20,
      keepAliveTimeout: 30_000,
    });
  }

  async procesarCobro(
    documento: string,
    monto: string,
    socioId?: string,
  ): Promise<boolean> {
    if (!this.pagosHabilitado) {
      return true;
    }

    const baseUrl = this.config.get<string>('TERCEROS_URL');
    if (!baseUrl) {
      this.logger.error('Falta la variable de entorno TERCEROS_URL');
      throw new ServiceUnavailableException('Servicio de pagos no disponible');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (socioId) {
      headers['X-Socio-Id'] = socioId;
    }

    let respuesta: Awaited<ReturnType<typeof fetch>>;
    try {
      respuesta = await fetch(`${baseUrl}/pagos/cobros`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ documento, monto }),
        signal: AbortSignal.timeout(this.timeoutMs),
        dispatcher: this.poolTerceros,
      });
    } catch (error) {
      this.logger.error(`Terceros (pagos) no respondio: ${String(error)}`);
      throw new ServiceUnavailableException('Servicio de pagos no disponible');
    }

    if (respuesta.status >= 500) {
      await respuesta.text().catch(() => undefined);
      this.logger.error(`Terceros (pagos) respondio ${respuesta.status}`);
      throw new ServiceUnavailableException('Servicio de pagos no disponible');
    }

    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => ({}))) as {
        message?: string;
      };
      throw new HttpException(
        cuerpo.message ?? `Respuesta ${respuesta.status}`,
        respuesta.status,
      );
    }

    const resultado = (await respuesta.json()) as RespuestaCobro;
    return resultado.exitoso === true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.poolTerceros.close();
  }
}
