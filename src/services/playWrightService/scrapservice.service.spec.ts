import { Test, TestingModule } from '@nestjs/testing';
import { PlaywrightService } from './scrapservice.service';
import {
  glassdoorProvider,
  linkedinProvider,
  remotarProvider,
} from '../../config/providers';

describe('PlaywrightService', () => {
  let service: PlaywrightService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlaywrightService],
    }).compile();

    service = module.get<PlaywrightService>(PlaywrightService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('filters locations by provider and remote support correctly', () => {
    const remoteLoc = {
      label: 'Remoto (Brasil)',
      workplaceTypes: ['remote' as const],
    };
    const curitibaGlassdoorLoc = {
      provider: 'glassdoor' as const,
      label: 'Curitiba',
      workplaceTypes: ['onsite' as const, 'hybrid' as const],
    };
    const spLinkedinLoc = {
      provider: 'linkedin' as const,
      label: 'São Paulo',
      workplaceTypes: ['onsite' as const],
    };

    expect(service.isLocationSupported(remotarProvider, remoteLoc)).toBe(true);
    expect(
      service.isLocationSupported(remotarProvider, curitibaGlassdoorLoc),
    ).toBe(false);

    expect(
      service.isLocationSupported(glassdoorProvider, curitibaGlassdoorLoc),
    ).toBe(true);
    expect(service.isLocationSupported(glassdoorProvider, spLinkedinLoc)).toBe(
      false,
    );
    expect(service.isLocationSupported(linkedinProvider, spLinkedinLoc)).toBe(
      true,
    );
  });

  it('parses HTML job cards and strips rating suffixes from company names', () => {
    const html = `
      <ul>
        <li>
          <h3 class="base-search-card__title">Desenvolvedor Node.js Pleno</h3>
          <h4 class="base-search-card__subtitle">Decathlon 4,2</h4>
          <a class="base-card__full-link" href="/jobs/view/12345">Ver vaga</a>
        </li>
      </ul>
    `;

    const jobs = service.parseHtml(html, linkedinProvider, 'Remoto');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      title: 'Desenvolvedor Node.js Pleno',
      company: 'Decathlon',
      location: 'Remoto',
      text: 'Vaga: Desenvolvedor Node.js Pleno | Empresa: Decathlon',
      url: 'https://www.linkedin.com/jobs/view/12345',
    });
  });

  it('recovers when page.evaluate fails due to client-side navigation redirect', async () => {
    const html = `
      <ul>
        <li>
          <h3 class="base-search-card__title">Backend Node.js</h3>
          <h4 class="base-search-card__subtitle">Acme</h4>
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/999">Ver</a>
        </li>
      </ul>
    `;
    const mockPage = {
      goto: jest.fn().mockResolvedValue(undefined),
      evaluate: jest
        .fn()
        .mockRejectedValueOnce(new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation'))
        .mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      content: jest.fn().mockResolvedValue(html),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const mockContext = {
      newPage: jest.fn().mockResolvedValue(mockPage),
    };

    const jobs = await (service as any).scrapeSingleTask(mockContext, {
      provider: linkedinProvider,
      query: 'desenvolvedor nodejs',
      locOption: { label: 'Remoto', workplaceTypes: ['remote'] },
    });

    expect(mockPage.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 10000 });
    expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
    expect(mockPage.close).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Backend Node.js');
  });

  it('recovers when page.content fails because the page is still navigating', async () => {
    const html = `
      <ul>
        <li>
          <h3 class="base-search-card__title">Full-Stack Pleno</h3>
          <h4 class="base-search-card__subtitle">Acme</h4>
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/1000">Ver</a>
        </li>
      </ul>
    `;
    const mockPage = {
      goto: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(undefined),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      content: jest
        .fn()
        .mockRejectedValueOnce(
          new Error('page.content: Unable to retrieve content because the page is navigating and changing the content.'),
        )
        .mockResolvedValueOnce(html),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const mockContext = {
      newPage: jest.fn().mockResolvedValue(mockPage),
    };

    const jobs = await (service as any).scrapeSingleTask(mockContext, {
      provider: linkedinProvider,
      query: 'desenvolvedor full-stack pleno',
      locOption: { label: 'Remoto', workplaceTypes: ['remote'] },
    });

    expect(mockPage.content).toHaveBeenCalledTimes(2);
    expect(mockPage.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 10000 });
    expect(mockPage.close).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Full-Stack Pleno');
  });
});
