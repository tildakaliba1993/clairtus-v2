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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { FeeResponsibility } from '@clairtus/core';

/**
 * Request DTOs as decorated classes so the global ValidationPipe rejects malformed payloads with
 * 422 and @nestjs/swagger derives real request schemas at /docs. Money fields are integer minor units.
 */
export class CreatePartyDto {
  @ApiProperty({ example: 'seller', description: 'buyer | seller | secondary' })
  @IsString()
  @IsNotEmpty()
  role!: string;

  @ApiPropertyOptional({ example: 'Sue Seller' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '+27123456789' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Bank account / wallet reference for payouts', example: '0000000000' })
  @IsOptional()
  @IsString()
  accountRef?: string;

  @ApiPropertyOptional({ description: 'Bank/branch code for payouts', example: '033' })
  @IsOptional()
  @IsString()
  bankCode?: string;
}

export class CreateEscrowDto {
  @ApiProperty({ description: 'Base amount in integer minor units (e.g. cents)', example: 100000 })
  @IsInt()
  @IsPositive()
  baseAmount!: number;

  @ApiProperty({ description: 'ISO-4217 currency code', example: 'ZAR' })
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency!: string;

  @ApiProperty({ description: 'Platform fee in basis points (150 = 1.5%)', example: 150, minimum: 0, maximum: 10000 })
  @IsInt()
  @Min(0)
  @Max(10_000)
  feeBps!: number;

  @ApiProperty({ enum: ['SELLER', 'BUYER', 'SPLIT'], description: 'Who bears the fee' })
  @IsIn(['SELLER', 'BUYER', 'SPLIT'])
  feeResponsibility!: FeeResponsibility;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  buyerPartyId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  sellerPartyId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsString()
  secondaryPartyId?: string;

  @ApiPropertyOptional({ description: 'Secondary beneficiary amount (minor units)', example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  secondaryAmount?: number;
}

export class CreatePayoutDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  escrowId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsString()
  @IsNotEmpty()
  recipientPartyId!: string;

  @ApiProperty({ description: 'Payout amount in minor units', example: 98500 })
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ description: "Sandbox only: { simulate: 'succeeded' | 'failed' | 'pending' }" })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
