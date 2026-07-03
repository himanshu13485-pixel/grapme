// Load .env before any module evaluates process.env (e.g. QUEUE_ENABLED).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  assertSecrets(config);

  app.setGlobalPrefix('api/v1');

  // Don't advertise the framework, and set baseline security headers on every
  // response (dependency-free — equivalent to the core of helmet for a JSON API).
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
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

  const port = config.get<number>('API_PORT', 4000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`AEO API running on http://localhost:${port}/api/v1`);
}
bootstrap();
