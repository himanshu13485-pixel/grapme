// Load .env before any module evaluates process.env (e.g. QUEUE_ENABLED).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response, NextFunction } from 'express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { activityContext } from './common/activity-context';

/**
 * Fail fast (in production) when a security-critical secret is missing, weak, or
 * still set to a placeholder. In development we only warn so onboarding is easy.
 */
function assertSecrets(config: ConfigService) {
  const logger = new Logger('Security');
  const isProd = process.env.NODE_ENV === 'production';
  const required = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'CREDENTIAL_ENCRYPTION_KEY',
  ];
  for (const key of required) {
    const val = config.get<string>(key) ?? '';
    const weak =
      val.length < 32 ||
      /change-me|replace_with|example|secret-min/i.test(val);
    if (weak) {
      const msg = `${key} is missing or weak — set a strong random value (>= 32 chars).`;
      if (isProd) throw new Error(`[security] ${msg}`);
      logger.warn(`${msg} (OK for dev; MUST be set in production)`);
    }
  }
}

/**
 * Warn loudly when LinkedIn (Unipile) is configured but APP_PUBLIC_URL is blank.
 * Without a public base URL we can't build the hosted-auth notify_url, so Unipile
 * never calls the account webhook back — every connected seat stays stuck on
 * PENDING. This is the single most common "connect looks fine but never completes"
 * misconfiguration, so surface it at boot.
 */
function warnLinkedInConfig(config: ConfigService) {
  const logger = new Logger('LinkedIn');
  const dsn = config.get<string>('UNIPILE_DSN');
  const apiKey = config.get<string>('UNIPILE_API_KEY');
  const publicUrl = config.get<string>('APP_PUBLIC_URL');
  if ((dsn || apiKey) && !publicUrl) {
    logger.warn(
      'UNIPILE_DSN/UNIPILE_API_KEY are set but APP_PUBLIC_URL is blank — the Unipile ' +
        'account webhook (notify_url) cannot be built, so connected LinkedIn seats will ' +
        "stay stuck on PENDING. Set APP_PUBLIC_URL to this API's public base URL (no " +
        'trailing slash) and make sure Unipile can reach it.',
    );
  } else if ((dsn || apiKey) && publicUrl && !config.get<string>('UNIPILE_WEBHOOK_SECRET')) {
    logger.warn(
      'Unipile is configured but UNIPILE_WEBHOOK_SECRET is blank — the account webhook ' +
        'is unauthenticated. Set a strong secret (openssl rand -hex 24) for production.',
    );
  }
}

async function bootstrap() {
  // Own the body parsers so base64 image uploads aren't capped at the 100kb
  // default. Keep a sane ceiling to avoid abuse.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));
  // Per-request audit context: lets the global activity-audit interceptor know
  // whether a handler already wrote its own, more specific activity entry.
  app.use((_req: Request, _res: Response, next: NextFunction) =>
    activityContext.run({ logged: false }, next),
  );
  const config = app.get(ConfigService);
  assertSecrets(config);
  warnLinkedInConfig(config);

  app.setGlobalPrefix('api/v1');

  // Don't advertise the framework, and set baseline security headers on every
  // response (dependency-free — equivalent to the core of helmet for a JSON API).
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  // Behind the reverse proxy (cPanel/nginx, BIND_HOST=127.0.0.1) the direct socket IP
  // is the proxy's loopback address. Trust the first hop so req.ip is the real client
  // IP from X-Forwarded-For — needed for open/click geolocation and session IP tracking.
  express.set('trust proxy', 1);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Allow one or more comma-separated origins; credentials for cookie/refresh.
  const origins = config
    .get<string>('CORS_ORIGIN', 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  // Seed the preset super-admin (ADMIN_EMAIL / ADMIN_PASSWORD) if configured.
  await app.get(AuthService).ensureBootstrapAdmin();

  const port = config.get<number>('API_PORT', 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`AEO API running on http://localhost:${port}/api/v1`);
}
bootstrap();
