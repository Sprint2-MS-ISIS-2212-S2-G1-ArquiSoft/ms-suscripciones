import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { CrearSuscripcionDto } from './dtos/crear-suscripcion.dto';
import { Suscripcion } from './entities/suscripcion.entity';
import {
  RespuestaSuscripcion,
  SuscripcionesService,
} from './suscripciones.service';

@Controller()
export class SuscripcionesController {
  constructor(private readonly suscripcionesService: SuscripcionesService) {}

  @Post('suscripciones')
  crear(
    @Body() dto: CrearSuscripcionDto,
    @Headers('x-socio-id') socioId?: string,
  ): Promise<RespuestaSuscripcion> {
    if (!socioId || !isUUID(socioId)) {
      throw new BadRequestException('Header X-Socio-Id requerido');
    }
    return this.suscripcionesService.crear(dto, socioId);
  }

  @Get('suscripciones')
  listar(@Query('clienteId') clienteId?: string): Promise<Suscripcion[]> {
    return this.suscripcionesService.listar(clienteId);
  }

  @Get('suscripciones/:id')
  obtener(@Param('id') id: string): Promise<Suscripcion> {
    return this.suscripcionesService.obtenerPorId(id);
  }

  @Get('metricas')
  metricas() {
    return this.suscripcionesService.obtenerMetricas();
  }
}
