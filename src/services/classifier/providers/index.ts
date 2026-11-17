import {
  LlmProvider,
  type ProviderDefinition,
  type ProviderProtocol,
} from '../../../domain/llm/provider.entity';
import { BUILTIN_PROVIDER_PRESETS } from '../../../domain/llm/provider.presets';
import { ProviderRegistry, type ProviderOverrideEntry } from '../../../domain/llm/provider.registry';
import { LLM_PROTOCOL_ADAPTERS } from '../../../infra/llm/protocol.adapters';

export const CLASSIFIER_PROVIDERS = 'CLASSIFIER_PROVIDERS';

export const createLlmProvider = (definition: ProviderDefinition): LlmProvider =>
  new LlmProvider(definition, LLM_PROTOCOL_ADAPTERS[definition.protocol]);

export const createProviders = (overrides?: Record<string, ProviderOverrideEntry>): LlmProvider[] =>
  new ProviderRegistry(LLM_PROTOCOL_ADAPTERS, BUILTIN_PROVIDER_PRESETS, overrides).getAll();

export {
  BUILTIN_PROVIDER_PRESETS as BUILTIN_PROVIDER_DEFINITIONS,
  LlmProvider as GenericLlmProvider,
  LlmProvider,
  ProviderRegistry,
  type ProviderDefinition,
  type ProviderOverrideEntry,
  type ProviderProtocol,
};
