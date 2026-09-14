import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { ActivityService } from '../services/activity.service';
import { activityContext } from '../activity-context';
import { AuthUser } from '../decorators/current-user.decorator';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Writes that are not meaningful audit events: sign-in flows, provider
 * webhooks, notification/read receipts, mailbox syncs, connection tests and AI
 * drafting (which changes nothing until the draft is saved).
 */
const SKIP_ROUTE =
  /\/(auth|webhooks?|notifications|ai|verify|whatsapp-verify)\/|\/(mark-read|read|sync|heartbeat|ping|test|test-imap|spam-check|validate-email|preview)$/;

/** Never store these request fields, at any depth. */
const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|credential|otp|cookie|authorization/i;

const VERB: Record<string, string> = {
  create: 'CREATE',
  update: 'UPDATE',
  patch: 'UPDATE',
  remove: 'DELETE',
  delete: 'DELETE',
};

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

function singular(noun: string): string {
  if (/IES$/.test(noun)) return noun.replace(/IES$/, 'Y');
  if (/(X|CH|SH|SS)ES$/.test(noun)) return noun.replace(/ES$/, '');
  if (/S$/.test(noun) && !/SS$/.test(noun)) return noun.replace(/S$/, '');
  return noun;
}

/** `TemplatesController.create` → CREATE_TEMPLATE; `ProgramsController.setSequence` → SET_SEQUENCE. */
export function auditAction(controller: string, handler: string): { action: string; entityType: string } {
  const noun = singular(snake(controller.replace(/Controller$/, '')));
  const entityType = noun.toLowerCase().replace(/(^|_)([a-z])/g, (_m, _s, c: string) => c.toUpperCase());
  const words = snake(handler);
  if (!words.includes('_')) return { action: `${VERB[handler] ?? words}_${noun}`, entityType };
  return { action: words.startsWith('REMOVE_') ? `DELETE_${words.slice(7)}` : words, entityType };
}

/** Request payload made safe and small enough to keep in the audit trail. */
function clean(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    if (depth > 1 || v.length > 20) return `[${v.length} items]`;
    return v.map((x) => clean(x, depth + 1));
  }
  if (depth > 2) return '{…}';
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !SECRET_KEY.test(k))
      .map(([k, x]) => [k, clean(x, depth + 1)]),
  );
}

interface AuditRequest {
  method: string;
  route?: { path?: string };
  originalUrl?: string;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  ip?: string;
  user?: AuthUser;
}

/**
 * The activity log's safety net: every successful authenticated write lands in
 * it, so no update goes unrecorded — including ones whose service never calls
 * ActivityService. A handler that already logged its own, more specific entry
 * is skipped, so nothing is recorded twice.
 */
@Injectable()
export class ActivityAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('ActivityAudit');

  constructor(private readonly activity: ActivityService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuditRequest>();
    if (!WRITE_METHODS.has(req.method)) return next.handle();
    return next.handle().pipe(
      tap(() => {
        this.record(ctx, req).catch((err) =>
          this.logger.warn(`Could not record activity: ${(err as Error)?.message ?? err}`),
        );
      }),
    );
  }

  private async record(ctx: ExecutionContext, req: AuditRequest) {
    const user = req.user;
    if (!user?.tenantId || !user.userId) return;
    if (activityContext.getStore()?.logged) return;
    const path = req.route?.path ?? (req.originalUrl ?? '').split('?')[0];
    if (SKIP_ROUTE.test(path)) return;

    const { action, entityType } = auditAction(ctx.getClass().name, ctx.getHandler().name);
    const params = req.params ?? {};
    const entityId =
      params.id ?? params.cohortId ?? params.clientId ?? params.userId ?? Object.values(params)[0];
    const body = clean(req.body);
    const clientId =
      (body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).clientId
        : undefined) ?? req.query?.clientId ?? params.clientId;

    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action,
      entityType,
      entityId: typeof entityId === 'string' ? entityId : undefined,
      after: {
        ...(body && typeof body === 'object' && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : body !== undefined
            ? { body }
            : {}),
        ...(typeof clientId === 'string' && clientId ? { clientId } : {}),
        request: `${req.method} ${path}`,
      },
      ipAddress: req.ip,
    });
  }
}
