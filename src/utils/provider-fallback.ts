export type FallbackScope = 'classifier' | 'cv';

export function buildFriendlyProviderExhaustedMessage(
  scope: FallbackScope,
  attemptedProviders: string[],
  lastError?: string,
): string {
  const taskLabel = scope === 'cv' ? 'adaptação do seu currículo' : 'classificação das vagas';
  const providersLabel = attemptedProviders.length > 0 ? attemptedProviders.join(' → ') : 'nenhum provider ativo';
  const detail = lastError ? `\n🔍 *Último erro:* ${lastError.slice(0, 180)}` : '';

  return [
    `⚠️ *Limite de IA atingido no LioApply*`,
    `Não foi possível concluir a ${taskLabel} porque todos os serviços configurados (${providersLabel}) atingiram o limite de requisições ou retornaram erro.${detail}`,
    `💡 *Sugestão:* aguarde a renovação da cota gratuita ou adicione outra chave de API no \`.env\` / \`fallbackProviders\` no \`jobs.config.yaml\`.`,
  ].join('\n\n');
}

export class AllProvidersExhaustedError extends Error {
  readonly scope: FallbackScope;
  readonly attemptedProviders: string[];
  readonly errors: string[];

  constructor(scope: FallbackScope, attemptedProviders: string[], errors: string[]) {
    const lastError = errors[errors.length - 1];
    super(buildFriendlyProviderExhaustedMessage(scope, attemptedProviders, lastError));
    this.name = 'AllProvidersExhaustedError';
    this.scope = scope;
    this.attemptedProviders = attemptedProviders;
    this.errors = errors;
  }
}
