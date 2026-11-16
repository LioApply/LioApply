import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { desc, eq, gte, sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sentJobs } from '../database/schema';

export interface StoredJobRecord {
  id?: number;
  url: string;
  title: string;
  company?: string;
  description?: string;
  sent_at?: Date;
}

const SUMMARY_FIELDS = {
  id: sentJobs.id,
  url: sentJobs.url,
  title: sentJobs.nome_vaga,
  company: sentJobs.company,
  sent_at: sentJobs.sent_at,
};
const FULL_FIELDS = { ...SUMMARY_FIELDS, description: sentJobs.description };

const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS sent_jobs (
    id SERIAL PRIMARY KEY, url TEXT UNIQUE NOT NULL, nome_vaga TEXT, company TEXT, sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  ALTER TABLE sent_jobs ADD COLUMN IF NOT EXISTS nome_vaga TEXT;
  ALTER TABLE sent_jobs ADD COLUMN IF NOT EXISTS company TEXT;
  ALTER TABLE sent_jobs ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE sent_jobs DROP CONSTRAINT IF EXISTS sent_jobs_nome_vaga_key;
  CREATE INDEX IF NOT EXISTS idx_sent_jobs_url ON sent_jobs (url);
  CREATE INDEX IF NOT EXISTS idx_sent_jobs_nome_vaga ON sent_jobs (nome_vaga);
  CREATE INDEX IF NOT EXISTS idx_sent_jobs_company ON sent_jobs (company);
  CREATE INDEX IF NOT EXISTS idx_sent_jobs_sent_at ON sent_jobs (sent_at);
`;

@Injectable()
export class JobHistoryRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobHistoryRepository.name);
  private pool: Pool;
  private db: NodePgDatabase<{ sentJobs: typeof sentJobs }>;

  async onModuleInit() {
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.DATABASE_CONNECTION_URI });
    this.db = drizzle(this.pool, { schema: { sentJobs } });
    try {
      await this.pool.query(SCHEMA_DDL);
      this.logger.log('✅ Drizzle ORM conectado e tabela sent_jobs verificada.');
    } catch (error) {
      this.logger.error('Erro ao conectar ou criar tabela sent_jobs:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  async getRecentJobs(limit = 60, days = 30): Promise<StoredJobRecord[]> {
    return this.safeQuery('Erro ao buscar histórico recente de vagas:', [], async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const rows = await this.db
        .select(SUMMARY_FIELDS)
        .from(sentJobs)
        .where(gte(sentJobs.sent_at, cutoffDate))
        .orderBy(desc(sentJobs.sent_at))
        .limit(limit);
      return rows.map((row) => this.toStoredRecord(row));
    });
  }

  async getJobById(id: number): Promise<StoredJobRecord | null> {
    if (!id || Number.isNaN(id)) return null;
    return this.safeQuery(`Erro ao buscar vaga por ID (${id}):`, null, async () => {
      const [row] = await this.db.select(FULL_FIELDS).from(sentJobs).where(eq(sentJobs.id, id)).limit(1);
      return row ? this.toStoredRecord(row, true) : null;
    });
  }

  async save(jobs: { url: string; title: string; company?: string; description?: string }[]): Promise<StoredJobRecord[]> {
    if (jobs.length === 0) return [];
    return this.safeQuery('Erro ao persistir vagas no banco com Drizzle:', [], async () => {
      const values = jobs.map((j) => ({
        url: j.url,
        nome_vaga: j.title,
        company: j.company || '',
        description: j.description || '',
      }));
      const inserted = await this.db
        .insert(sentJobs)
        .values(values)
        .onConflictDoUpdate({
          target: sentJobs.url,
          set: {
            nome_vaga: sql`EXCLUDED.nome_vaga`,
            company: sql`CASE WHEN EXCLUDED.company <> '' THEN EXCLUDED.company ELSE sent_jobs.company END`,
            description: sql`CASE WHEN EXCLUDED.description <> '' THEN EXCLUDED.description ELSE sent_jobs.description END`,
          },
        })
        .returning(FULL_FIELDS);

      this.logger.log(`💾 ${jobs.length} vagas persistidas no banco com Drizzle.`);
      return inserted.map((row) => this.toStoredRecord(row, true));
    });
  }

  private async safeQuery<T>(errorMsg: string, fallback: T, query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch (error) {
      this.logger.error(errorMsg, error);
      return fallback;
    }
  }

  private toStoredRecord(
    row: { id: number; url: string; title: string | null; company: string | null; sent_at: Date | null; description?: string | null },
    includeDescription = false,
  ): StoredJobRecord {
    return {
      id: row.id,
      url: row.url,
      title: row.title || '',
      company: row.company || '',
      ...(includeDescription ? { description: row.description || '' } : {}),
      sent_at: row.sent_at || undefined,
    };
  }
}
