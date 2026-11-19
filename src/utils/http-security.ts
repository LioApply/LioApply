import {
  ArgumentMetadata,
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  PipeTransform,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { getEvolutionApiKey } from './evolution';

export interface ValidatableDtoClass<T = unknown> {
  new (...args: any[]): T;
  validate?(value: unknown): T;
}

function safeCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractBearerToken(authHeader?: string): string {
  if (!authHeader) return '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function extractRequestToken(req: Record<string, any>): string {
  const headers = (req?.headers || {}) as Record<string, string | string[] | undefined>;
  const headerVal = (name: string): string => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] || '' : v || '';
  };

  return (
    headerVal('x-api-key').trim() ||
    headerVal('apikey').trim() ||
    headerVal('x-webhook-secret').trim() ||
    extractBearerToken(headerVal('authorization')) ||
    (typeof req?.query?.secret === 'string' ? req.query.secret.trim() : '') ||
    (typeof req?.query?.token === 'string' ? req.query.token.trim() : '') ||
    (typeof req?.body?.apikey === 'string' ? req.body.apikey.trim() : '')
  );
}

/**
 * Guard for administrative HTTP routes (`/instance/*`, `/message/*`).
 * Requires `HTTP_API_KEY`, `AUTHENTICATION_API_KEY`, or `apiKey` to be configured and matched.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Record<string, any>>();
    const expected = (process.env.HTTP_API_KEY || getEvolutionApiKey()).trim();
    if (!expected) {
      throw new UnauthorizedException(
        'Acesso bloqueado: configure HTTP_API_KEY ou AUTHENTICATION_API_KEY no ambiente.',
      );
    }

    const provided = extractRequestToken(req);
    if (!provided || !safeCompare(provided, expected)) {
      throw new UnauthorizedException('API key inválida ou ausente.');
    }
    return true;
  }
}

/**
 * Guard for `POST /webhook/evolution`.
 * Validates `WEBHOOK_SECRET` (or `EVOLUTION_WEBHOOK_SECRET`) when configured; if the request includes
 * a token/apikey when `AUTHENTICATION_API_KEY` is set, validates it against configured secrets.
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Record<string, any>>();
    const webhookSecret = (process.env.WEBHOOK_SECRET || process.env.EVOLUTION_WEBHOOK_SECRET || '').trim();
    const apiKey = (process.env.HTTP_API_KEY || getEvolutionApiKey()).trim();
    const provided = extractRequestToken(req);

    if (webhookSecret) {
      const matchesWebhook = Boolean(provided && safeCompare(provided, webhookSecret));
      const matchesApiKey = Boolean(provided && apiKey && safeCompare(provided, apiKey));
      if (!matchesWebhook && !matchesApiKey) {
        throw new UnauthorizedException('Webhook secret inválido ou ausente.');
      }
      return true;
    }

    if (provided && apiKey && !safeCompare(provided, apiKey)) {
      throw new UnauthorizedException('Credencial de webhook inválida.');
    }
    return true;
  }
}

/**
 * Lightweight runtime validation pipe for HTTP DTO classes implementing `static validate(value)`.
 */
@Injectable()
export class HttpValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'body') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException('O corpo da requisição (JSON body) deve ser um objeto válido.');
      }
      const metatype = metadata.metatype as ValidatableDtoClass | undefined;
      if (metatype && typeof metatype.validate === 'function') {
        return metatype.validate(value);
      }
    }
    if (metadata.type === 'param' && metadata.data === 'instanceName') {
      if (typeof value !== 'string' || !value.trim() || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.trim())) {
        throw new BadRequestException('Parâmetro instanceName inválido.');
      }
      return value.trim();
    }
    return value;
  }
}
