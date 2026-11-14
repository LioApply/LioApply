import { GeminiService } from './gemini.service';
import { GroqService } from './groq.service';
import { JevService } from './jev.service';
import { OllamaService } from './ollama.service';
import { OpenRouterService } from './openrouter.service';

export const CLASSIFIER_PROVIDERS = 'CLASSIFIER_PROVIDERS';

export const CLASSIFIER_PROVIDER_CLASSES = [
  GroqService,
  GeminiService,
  OpenRouterService,
  OllamaService,
  JevService,
];

export {
  GeminiService,
  GroqService,
  JevService,
  OllamaService,
  OpenRouterService,
};
