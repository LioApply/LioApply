import { Injectable, Logger } from '@nestjs/common';
import { ScrapedPost } from '../../interfaces/ScrapedPost/iscrapedpost.interface';

@Injectable()
export class LinkedinApifyService {
  private readonly logger = new Logger(LinkedinApifyService.name);

  async scrapeLinkedinPosts(query: string[]): Promise<ScrapedPost[]> {
    const apifyUrl = process.env.APIFY_URL?.trim();
    if (!apifyUrl) {
      throw new Error('APIFY_URL não configurada no ambiente.');
    }
    try {
      this.logger.log(`Executando Apify Actor em modo síncrono. Aguardando resultados de ${query.length} queries...`);
      const res = await fetch(apifyUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxPosts: 20,
          postNestedComments: false,
          postNestedReactions: false,
          postedLimit: '24h',
          scrapeComments: false,
          scrapeReactions: false,
          searchQueries: query,
          sortBy: 'date',
        }),
      });

      if (!res.ok) {
        this.logger.error(`Erro no Apify API (${res.status}): ${await res.text()}`);
        throw new Error(`Apify error: ${res.statusText}`);
      }

      const data = await res.json();
      return Array.isArray(data)
        ? data.map((item: any) => ({
            text: item.content || '',
            url: item.linkedinUrl || '',
            company: item.author?.name || '',
            title: 'Vaga via LinkedIn Post',
          }))
        : [];
    } catch (error: any) {
      this.logger.error(`Erro ao buscar posts do LinkedIn: ${error.message}`, error.stack);
      throw error;
    }
  }
}
