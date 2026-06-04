import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type { FeeResponsibility } from '@clairtus/core';

/**
 * Request DTOs as decorated classes so the global ValidationPipe rejects malformed payloads with
 * 422 (and the OpenAPI doc can derive real schemas — M4). Money fields are integer minor units.
 */
export class CreatePartyDto {
  @IsString()
  @IsNotEmpty()
  role!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  accountRef?: string;

  @IsOptional()
  @IsString()
  bankCode?: string;
}

export class CreateEscrowDto {
  @IsInt()
  @IsPositive()
  baseAmount!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency!: string;

  @IsInt()
  @Min(0)
  @Max(10_000)
  feeBps!: number;

  @IsIn(['SELLER', 'BUYER', 'SPLIT'])
  feeResponsibility!: FeeResponsibility;

  @IsOptional()
  @IsString()
  buyerPartyId?: string;

  @IsString()
  @IsNotEmpty()
  sellerPartyId!: string;

  @IsOptional()
  @IsString()
  secondaryPartyId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  secondaryAmount?: number;
}

export class CreatePayoutDto {
  @IsString()
  @IsNotEmpty()
  escrowId!: string;

  @IsString()
  @IsNotEmpty()
  recipientPartyId!: string;

  @IsInt()
  @IsPositive()
  amount!: number;

  /** Sandbox only: { simulate: 'succeeded' | 'failed' | 'pending' } drives the simulated rail. */
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
