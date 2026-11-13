import { IsNotEmpty, IsNumberString, IsString, IsUUID } from 'class-validator';

export class CrearSuscripcionDto {
  @IsUUID()
  cotizacionId!: string;

  @IsUUID()
  clienteId!: string;

  @IsString()
  @IsNotEmpty()
  documento!: string;

  @IsNumberString()
  primaMensual!: string;

  @IsNumberString()
  sumaAsegurada!: string;
}
