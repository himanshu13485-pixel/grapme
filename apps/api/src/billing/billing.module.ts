import { Module } from '@nestjs/common';
import { LinkedinModule } from '../linkedin/linkedin.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { CashfreeProvider } from './cashfree.provider';

/** Billing: payment mode (Auto/Manual), plan-upgrade requests, Cashfree gateway. */
@Module({
  imports: [LinkedinModule, SubscriptionsModule],
  providers: [BillingService, CashfreeProvider],
  controllers: [BillingController],
})
export class BillingModule {}
