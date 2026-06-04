import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { KycLevel } from '@clairtus/kyc';

export class CreateKycCheckDto {
  @IsString()
  @IsNotEmpty()
  partyId!: string;

  @IsOptional()
  @IsIn(['biometric', 'document'])
  level?: KycLevel;
}
