import { Logger } from '@nestjs/common';
import {
  ClassifierProvider,
  ClassifierResolution,
} from '../../../interfaces/classifier/classifier.interface';
import {
  ClassifierProviderConfig,
  ClassifierProviderType,
  GeminiClassifierClient,
  NativeSystemOneHttpClient,
  OpenAiCompatibleClassifierClient,
} from '../classifier-clients';

export interface ProviderDefaults {
  label: string;
  baseUrl: string;
  model: string;
  /** Variáveis de ambiente aceitas para a chave de API (em ordem de prioridade). */
  keyEnvs?: string[];
  urlEnvs?: string[];
  modelEnvs?: string[];
  requiresKey?: boolean;
  headers?: Record<string, string>;
}

const firstEnv = (names: string[] = []) =>
  names.map((n) => process.env[n]).find(Boolean) || '';

interface Resolved {
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** Resolve chave/modelo/URL (config > env > default); subclasses só definem `build`. */
abstract class BaseProvider implements ClassifierProvider {
  abstract readonly id: ClassifierProviderType;
  protected abstract readonly defaults: ProviderDefaults;
  protected readonly logger = new Logger(this.constructor.name);

  protected abstract build(r: Resolved): ClassifierResolution;

  isConfigured(): boolean {
    return Boolean(firstEnv(this.defaults.keyEnvs));
  }

  createClient(config: ClassifierProviderConfig): ClassifierResolution | null {
    const d = this.defaults;
    const apiKey = config.apiKey || firstEnv(d.keyEnvs);
    if (d.requiresKey && !apiKey) {
      this.logger.warn(
        `⚠️ CLASSIFIER_PROVIDER=${this.id} selecionado, mas ${d.keyEnvs?.join(' / ')} / CLASSIFIER_API_KEY não foi encontrada.`,
      );
      return null;
    }
    return this.build({
      apiKey,
      model: config.model || firstEnv(d.modelEnvs) || d.model,
      baseUrl: config.baseUrl || firstEnv(d.urlEnvs) || d.baseUrl,
    });
  }
}

/** Groq, OpenRouter, Ollama e qualquer endpoint OpenAI-compatible. */
export abstract class OpenAiCompatibleProvider extends BaseProvider {
  protected build({ apiKey, model, baseUrl }: Resolved): ClassifierResolution {
    const { label, headers } = this.defaults;
    return {
      client: new OpenAiCompatibleClassifierClient({
        baseUrl,
        apiKey: apiKey || this.id,
        model,
        providerName: label,
        extraHeaders: headers,
      }),
      name: `${this.id} (${model})`,
    };
  }
}

/** Protocolo nativo `/v1/systemone` (Jev). */
export abstract class SystemOneProvider extends BaseProvider {
  protected build({ apiKey, model, baseUrl }: Resolved): ClassifierResolution {
    return {
      client: new NativeSystemOneHttpClient({
        baseUrl,
        apiKey: apiKey || undefined,
        model,
        providerName: this.defaults.label,
      }),
      name: `${this.id} (${baseUrl})`,
    };
  }
}

export abstract class GeminiBaseProvider extends BaseProvider {
  protected build({ apiKey, model, baseUrl }: Resolved): ClassifierResolution {
    return {
      client: new GeminiClassifierClient({ apiKey, model, baseUrl }),
      name: `${this.id} (${model})`,
    };
  }
}
