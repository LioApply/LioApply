import { Injectable } from '@nestjs/common';

export interface ApprovedJobDto {
  id?: number;
  title?: string;
  company?: string;
  score: number;
  reason: string;
  url: string;
  previewText: string;
}

const MAX_DIGEST_JOBS = 15;
const MAX_DIGEST_CHARS = 3800;

const escapeWhatsappMarkdown = (text: string): string =>
  text.replace(/([_*~`])/g, '\\$1');

@Injectable()
export class JobDigestFormatter {
  format(jobs: ApprovedJobDto[]): string {
    const sortedJobs = [...jobs].sort((a, b) => b.score - a.score);
    const cappedJobs = sortedJobs.slice(0, MAX_DIGEST_JOBS);

    const digestTitle = `🚀 *Varredura Completa: ${sortedJobs.length} Novas Vagas Encontradas!* 🚀\n\n`;

    const chunks: string[] = [];
    let currentLength = digestTitle.length + sortedJobs.length;

    for (let index = 0; index < cappedJobs.length; index++) {
      const job = cappedJobs[index];
      const idBadge = job.id ? ` [#${job.id}]` : '';
      const titleLabel = job.title
        ? ` — *${escapeWhatsappMarkdown(job.title)}*${job.company ? ` (${escapeWhatsappMarkdown(job.company)})` : ''}`
        : '';
      const entry = [
        `*${index + 1}️${idBadge}*${titleLabel}`,
        `📝 *Resumo:* _"${escapeWhatsappMarkdown(job.previewText || '')}..."_`,
        job.url && job.url.startsWith('http') ? `🔗 *Link:* ${job.url}` : '',
        '──────────────────',
      ]
        .filter(Boolean)
        .join('\n');

      if (chunks.length > 0 && currentLength + entry.length + 2 > MAX_DIGEST_CHARS) break;
      chunks.push(entry);
      currentLength += entry.length + 2;
    }

    const omittedCount = sortedJobs.length - chunks.length;
    const omittedNote = omittedCount > 0 ? `\n\n_... e mais ${omittedCount} vagas omitidas para respeitar o limite do WhatsApp._` : '';

    return digestTitle + chunks.join('\n\n') + omittedNote;
  }
}
