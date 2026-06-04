import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { KycLevel } from '@clairtus/kyc';

export class CreateKycCheckDto {
  @ApiProperty({ format: 'uuid', description: 'Party to verify' })
  @IsString()
  @IsNotEmpty()
  partyId!: string;

  @ApiPropertyOptional({ enum: ['biometric', 'document'] })
  @IsOptional()
  @IsIn(['biometric', 'document'])
  level?: KycLevel;
}
