export interface NoulCriteria { true: string; false: string }
export interface NoulQuestion { type: 'noul'; instructions: string; criteria: NoulCriteria }

export interface SystemOneRequest<Q extends Record<string, NoulQuestion> = Record<string, NoulQuestion>> {
  state: Record<string, unknown>;
  questions: Q;
}
export interface SystemOneResponse<Q extends Record<string, NoulQuestion> = Record<string, NoulQuestion>> {
  answers: { [K in keyof Q]: { noul: number } };
}
export interface SystemOneClient {
  systemOne<Q extends Record<string, NoulQuestion>>(request: SystemOneRequest<Q>): Promise<SystemOneResponse<Q>>;
}
export interface UserProfileCriteria {
  targetRoles: string[];
  targetTechnologies: string[];
  acceptableLevels: string[];
  excludedLevels: string[];
  locations: string[];
}
