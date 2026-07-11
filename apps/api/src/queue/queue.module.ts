import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_DISPATCH,
  QUEUE_SEND,
  QUEUE_REPLIES,
  QUEUE_ENROLL,
  QUEUE_LINKEDIN,
} from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_DISPATCH },
      { name: QUEUE_SEND },
      { name: QUEUE_REPLIES },
      { name: QUEUE_ENROLL },
      { name: QUEUE_LINKEDIN },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
