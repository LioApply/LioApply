import { Injectable } from '@nestjs/common';
import { ScrapedPost } from '../interfaces/ScrapedPost/iscrapedpost.interface';

export interface JobIdentity {
  title: string;
  company?: string;
}

export interface NormalizedCandidateJob {
  title: string;
  company: string;
  text: string;
  location?: string;
  url: string;
}

export function normalizeScrapedPost(post: ScrapedPost): NormalizedCandidateJob | null {
  const text = (post.text || '').trim();
  if (!text && !post.title) return null;

  let title = post.title?.trim() || '';
  let company = post.company?.trim() || '';

  const match = (title || text).match(/^Vaga:\s*(.*?)(?:\s*\|\s*Empresa:\s*(.*))?$/i);
  if (match) {
    title = match[1]?.trim() || title;
    if (!company && match[2]) company = match[2].trim();
  }

  if (!title) {
    title = text.split('\n')[0].replace(/[#*•-]/g, '').trim().substring(0, 100) || 'Desenvolvedor';
  }
  if (company) company = company.replace(/\d+([.,]\d+)?\s*$/, '').trim();

  let url = post.url?.trim() || '';
  if (!url) {
    const hash = Buffer.from(text || title).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 50);
    url = `urn:job-hash:${hash}`;
  }

  return { title, company, text: text || `Vaga: ${title}`, location: post.location, url };
}

export const normalizeJobText = (text?: string): string =>
  text
    ? text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

export const generateJobKey = (title: string, company?: string): string =>
  `${normalizeJobText(title)}:::${normalizeJobText(company) || 'sem-empresa'}`;

export const isDuplicateJob = (candidate: JobIdentity, existingKeys: Set<string>): boolean =>
  existingKeys.has(generateJobKey(candidate.title, candidate.company));

export function createJobKeySet(jobs: JobIdentity[]): Set<string> {
  const set = new Set<string>();
  for (const job of jobs) {
    if (job?.title) set.add(generateJobKey(job.title, job.company));
  }
  return set;
}

export function deduplicateJobs<T extends JobIdentity>(jobs: T[], existingKeys?: Set<string>): T[] {
  const seen = new Set(existingKeys);
  const unique: T[] = [];
  for (const job of jobs) {
    if (!job?.title) continue;
    const key = generateJobKey(job.title, job.company);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(job);
    }
  }
  return unique;
}

@Injectable()
export class JobDeduplicationService {
  normalize = normalizeJobText;
  createKey = generateJobKey;
  isDuplicate = isDuplicateJob;
  createKeySet = createJobKeySet;
  deduplicate = deduplicateJobs;
}
