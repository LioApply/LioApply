import { Injectable } from '@nestjs/common';
import { SystemOneProvider } from './base.provider';

@Injectable()
export class JevService extends SystemOneProvider {
  readonly id = 'jev';
  protected readonly defaults = {
    label: 'SystemOne (jev)',
    baseUrl: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
    keyEnvs: ['TYPESAFE_API_KEY', 'JEV_API_KEY'],
  };
}
