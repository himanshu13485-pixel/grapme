import { Module } from '@nestjs/common';
import { ResponseTypesService } from './response-types.service';
import { ResponseTypesController } from './response-types.controller';

@Module({
  providers: [ResponseTypesService],
  controllers: [ResponseTypesController],
  exports: [ResponseTypesService],
})
export class ResponseTypesModule {}
