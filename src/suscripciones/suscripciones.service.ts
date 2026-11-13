import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { EmisionClient } from '../clients/emision.client';
import { TercerosClient } from '../clients/terceros.client';
import { CrearSuscripcionDto } from './dtos/crear-suscripcion.dto';
import { Suscripcion } from './entities/suscripcion.entity';
import { EstadoSuscripcion } from './enums/estado-suscripcion.enum';

export interface RespuestaSuscripcion {
  suscripcionId: string;
  estado: EstadoSuscripcion;
  puntajeRiesgo: number;
  polizaId: string;
  numeroPoliza: string;
  estadoPoliza: string;
  fechaInicioVigencia: string;
  fechaFinVigencia: string;
  cotizacionId: string;
  clienteId: string;
}

@Injectable()
export class SuscripcionesService {
  private readonly logger = new Logger(SuscripcionesService.name);
  private totalPeticiones = 0;
  private exitosas = 0;

  constructor(
    @InjectRepository(Suscripcion)
    private readonly suscripcionRepository: Repository<Suscripcion>,
    private readonly tercerosClient: TercerosClient,
    private readonly emisionClient: EmisionClient,
  ) {}

  async crear(
    dto: CrearSuscripcionDto,
    socioId: string,
  ): Promise<RespuestaSuscripcion> {
    this.totalPeticiones++;

    const suma = parseFloat(dto.sumaAsegurada);
    const puntajeRiesgo = suma > 1_000_000 ? 80 : suma > 500_000 ? 50 : 20;

    const suscripcion = this.suscripcionRepository.create({
      estado: EstadoSuscripcion.ACEPTADA,
      puntajeRiesgo,
      clienteId: dto.clienteId,
      cotizacionId: dto.cotizacionId,
    });
    const guardada = await this.suscripcionRepository.save(suscripcion);

    try {
      const pagoExitoso = await this.tercerosClient.procesarCobro(
        dto.documento,
        dto.primaMensual,
        socioId,
      );
      if (!pagoExitoso) {
        throw new HttpException(
          {
            message: 'El pago fue rechazado',
            error: 'Payment Required',
            statusCode: HttpStatus.PAYMENT_REQUIRED,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      const poliza = await this.emisionClient.emitirPoliza(
        {
          cotizacionId: dto.cotizacionId,
          clienteId: dto.clienteId,
          suscripcionId: guardada.id,
        },
        socioId,
      );

      this.exitosas++;
      return {
        suscripcionId: guardada.id,
        estado: guardada.estado,
        puntajeRiesgo: guardada.puntajeRiesgo,
        polizaId: poliza.id,
        numeroPoliza: poliza.numeroPoliza,
        estadoPoliza: poliza.estado,
        fechaInicioVigencia: poliza.fechaInicioVigencia,
        fechaFinVigencia: poliza.fechaFinVigencia,
        cotizacionId: dto.cotizacionId,
        clienteId: dto.clienteId,
      };
    } catch (error) {
      await this.suscripcionRepository
        .update({ id: guardada.id }, { estado: EstadoSuscripcion.RECHAZADA })
        .catch((err) =>
          this.logger.warn(
            `No se pudo marcar RECHAZADA la suscripcion ${guardada.id}: ${String(err)}`,
          ),
        );
      throw error;
    }
  }

  async listar(clienteId?: string): Promise<Suscripcion[]> {
    return this.suscripcionRepository.find({
      where: clienteId ? { clienteId } : {},
      order: { fechaEvaluacion: 'DESC' },
      take: 100,
    });
  }

  async obtenerPorId(id: string): Promise<Suscripcion> {
    if (!isUUID(id)) {
      throw new NotFoundException(`Suscripcion con id ${id} no encontrada`);
    }
    const suscripcion = await this.suscripcionRepository.findOne({
      where: { id },
    });
    if (!suscripcion) {
      throw new NotFoundException(`Suscripcion con id ${id} no encontrada`);
    }
    return suscripcion;
  }

  obtenerMetricas() {
    return {
      totalPeticiones: this.totalPeticiones,
      exitosas: this.exitosas,
      ...this.emisionClient.obtenerMetricas(),
    };
  }
}
