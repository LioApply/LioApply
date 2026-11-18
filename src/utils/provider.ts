import { IProviderConfig } from '../interfaces/isearch/isearch.interface';

/** Applies user overrides on top of a built-in provider preset, merging selectors shallowly. */
export function mergeProviderOverrides(base: IProviderConfig, overrides?: Partial<IProviderConfig>): IProviderConfig {
  return {
    ...base,
    ...overrides,
    selectors: { ...base.selectors, ...(overrides?.selectors || {}) },
  };
}
