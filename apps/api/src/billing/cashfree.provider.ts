import { Injectable, Logger } from '@nestjs/common';

export interface CreateOrderParams {
  requestId: string;
  amount: number;
  currency: string;
  customer: { name?: string; email?: string; phone?: string };
  returnUrl: string;
}
export interface CreateOrderResult {
  orderId?: string;
  paymentLink?: string | null;
}

/**
 * Cashfree payment gateway provider. STUBBED: reads credentials from env
 * (CASHFREE_APP_ID / CASHFREE_SECRET, CASHFREE_ENV=sandbox|production) but the
 * live create-order / signature-verification calls are TODO — until keys +
 * webhook are wired, createOrder returns no link so the request stays PENDING
 * and an admin activates it. Never commit secrets; set them in .env.
 */
@Injectable()
export class CashfreeProvider {
  private readonly logger = new Logger(CashfreeProvider.name);

  get configured(): boolean {
    return !!process.env.CASHFREE_APP_ID && !!process.env.CASHFREE_SECRET;
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    if (!this.configured) {
      this.logger.warn('Cashfree not configured — order creation skipped (manual activation).');
      return { paymentLink: null };
    }
    // TODO(cashfree): POST https://{sandbox|api}.cashfree.com/pg/orders with
    // x-client-id / x-client-secret, order_amount, order_currency, customer_details,
    // order_meta.return_url + notify_url (APP_PUBLIC_URL/api/v1/billing/cashfree/webhook).
    // Return { orderId, paymentLink: data.payment_link }.
    this.logger.warn('Cashfree create-order stub — live call not yet wired.');
    return { paymentLink: null };
  }

  /** TODO(cashfree): verify x-webhook-signature against the raw body + secret. */
  verifyWebhook(_headers: Record<string, unknown>, _rawBody: string): boolean {
    return this.configured;
  }
}
