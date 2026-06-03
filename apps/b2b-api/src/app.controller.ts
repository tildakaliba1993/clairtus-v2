import { Controller, Get } from '@nestjs/common';
import { Public } from './common/public.decorator';

@Controller('health')
export class AppController {
  @Public()
  @Get()
  health(): { status: string } {
    return { status: 'ok' };
  }
}
