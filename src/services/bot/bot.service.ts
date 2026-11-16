import { Injectable } from '@nestjs/common';
import { ILocationOption, IProviderConfig, Isearch } from '../../interfaces/isearch/isearch.interface';
import { ScrapedPost } from '../../interfaces/ScrapedPost/iscrapedpost.interface';
import { SendMediaDocumentDTO, SendMessageDTO } from '../../interfaces/SendMessageDTO';
import { PlaywrightService } from '../playWrightService/scrapservice.service';
import { WhatsappService } from '../whatsapp-service/whatsapp-service.service';

@Injectable()
export class BotService {
  constructor(
    private readonly scrapService: PlaywrightService,
    private readonly whatsappService: WhatsappService,
  ) {}

  makeRequest(search: Isearch) {
    return this.scrapService.scrape(search);
  }

  async scrapeProviders(
    providers: IProviderConfig[],
    queries: string[],
    locations: ILocationOption[],
  ): Promise<ScrapedPost[]> {
    if (typeof this.scrapService.scrapeProviders === 'function') {
      return this.scrapService.scrapeProviders(providers, queries, locations);
    }
    const results = await Promise.all(
      providers.map((provider) => this.makeRequest({ provider, searchQueries: queries, location: locations })),
    );
    return results.flatMap((posts) => (Array.isArray(posts) ? posts : []));
  }

  async sendMessage(content: SendMessageDTO) {
    await this.whatsappService.sendMessage(content);
  }

  async sendMediaDocument(content: SendMediaDocumentDTO) {
    await this.whatsappService.sendMediaDocument(content);
  }
}
