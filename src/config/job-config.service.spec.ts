import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import { JobConfigService } from './job-config.service';

jest.mock('fs');

describe('JobConfigService', () => {
  let service: JobConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should throw an error when no configuration file exists', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [JobConfigService],
    }).compile();

    service = module.get<JobConfigService>(JobConfigService);

    expect(() => service.onModuleInit()).toThrow(/Configuração ausente/);
  });

  it('should load configuration from yaml file on disk when present', async () => {
    const yamlMock = `
search:
  queries:
    - "frontend vue junior"
    - "backend golang pleno"
  locations:
    - label: "Remoto Global"
      workplaceTypes:
        - "remote"
      locationQuery: "remote"
profile:
  targetTechnologies:
    - "Vue"
    - "Go"
`;
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue(yamlMock);

    const module: TestingModule = await Test.createTestingModule({
      providers: [JobConfigService],
    }).compile();

    service = module.get<JobConfigService>(JobConfigService);
    service.onModuleInit();

    expect(service.getQueries()).toEqual([
      'frontend vue junior',
      'backend golang pleno',
    ]);
    expect(service.getLocations()[0].label).toBe('Remoto Global');
    expect(service.getUserProfile().targetTechnologies).toEqual(['Vue', 'Go']);
  });
});
