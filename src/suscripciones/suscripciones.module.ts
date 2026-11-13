import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmisionClient } from '../clients/emision.client';
import { TercerosClient } from '../clients/terceros.client';
import { Suscripcion } from './entities/suscripcion.entity';
import { SuscripcionesController } from './suscripciones.controller';
import { SuscripcionesService } from './suscripciones.service';

@Module({
  imports: [TypeOrmModule.forFeature([Suscripcion])],
  controllers: [SuscripcionesController],
  providers: [SuscripcionesService, EmisionClient, TercerosClient],
  exports: [SuscripcionesService],
})
export class SuscripcionesModule {}
