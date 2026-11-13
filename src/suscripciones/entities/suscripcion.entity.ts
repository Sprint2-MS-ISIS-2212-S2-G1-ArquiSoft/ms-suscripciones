import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EstadoSuscripcion } from '../enums/estado-suscripcion.enum';

/**
 * Evaluacion de riesgo y suscripcion de una cotizacion aceptada.
 *
 * Las relaciones hacia Cliente (identidad) y Cotizacion (cotizacion) se
 * almacenan como columnas de UUID sin FK entre bases de datos.
 */
@Entity('suscripciones')
export class Suscripcion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: EstadoSuscripcion })
  estado!: EstadoSuscripcion;

  @Column({ type: 'int' })
  puntajeRiesgo!: number;

  @CreateDateColumn()
  fechaEvaluacion!: Date;

  @Index('IDX_suscripciones_clienteId')
  @Column({ type: 'uuid', nullable: true })
  clienteId!: string | null;

  @Index('IDX_suscripciones_cotizacionId')
  @Column({ type: 'uuid', nullable: true })
  cotizacionId!: string | null;
}
