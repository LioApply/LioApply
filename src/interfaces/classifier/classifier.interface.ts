import type { SystemOneClient } from '../../utils/jev';
import type {
  ClassifierProviderConfig,
  ClassifierProviderType,
} from '../../services/classifier/classifier-clients';

export interface ClassifierResolution {
  client: SystemOneClient;
  name: string;
}

export interface ClassifierProvider {
  readonly id: ClassifierProviderType;
  /** True quando há credencial no ambiente (usado na auto-detecção). */
  isConfigured(): boolean;
  /** Cria o client System-One, ou `null` se faltar credencial obrigatória. */
  createClient(config: ClassifierProviderConfig): ClassifierResolution | null;
}
