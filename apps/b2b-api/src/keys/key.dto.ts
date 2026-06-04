import { ArrayUnique, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({ enum: ['test', 'live'], description: 'Sandbox (test) or production (live) key' })
  @IsIn(['test', 'live'])
  mode!: 'test' | 'live';

  @ApiPropertyOptional({ description: 'Scopes to grant (default: read-only). e.g. ["escrows:write"]', type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  scopes?: string[];
}
