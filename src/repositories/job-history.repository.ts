import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sentJobs } from '../database/schema';
import { type StoredJobRecord, type JobToPersist } from '../interfaces/job-history/job-history.interface';

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
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL || process.env.DATABASE_CONNECTION_URI,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
    this.pool.on('error', (err) => {
      this.logger.error('Erro inesperado em cliente ocioso do pool PostgreSQL:', err);
    });
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

  private ensureDb() {
    if (!this.db) {
      throw new Error('JobHistoryRepository não inicializado (onModuleInit não executado).');
    }
    return this.db;
  }

  async getRecentJobs(limit = 1000, days?: number): Promise<StoredJobRecord[]> {
    const db = this.ensureDb();
    try {
      let query = db.select(SUMMARY_FIELDS).from(sentJobs).$dynamic();
      if (days && days > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        query = query.where(gte(sentJobs.sent_at, cutoffDate));
      }
      const rows = await query.orderBy(desc(sentJobs.sent_at)).limit(limit);
      return rows.map((row) => this.toStoredRecord(row));
    } catch (error) {
      this.logger.error('Erro ao buscar histórico recente de vagas:', error);
      throw error;
    }
  }

  async getJobById(id: number): Promise<StoredJobRecord | null> {
    if (!id || Number.isNaN(id)) return null;
    const db = this.ensureDb();
    return this.safeQuery(`Erro ao buscar vaga por ID (${id}):`, null, async () => {
      const [row] = await db.select(FULL_FIELDS).from(sentJobs).where(eq(sentJobs.id, id)).limit(1);
      return row ? this.toStoredRecord(row, true) : null;
    });
  }

  async save(jobs: JobToPersist[]): Promise<StoredJobRecord[]> {
    if (jobs.length === 0) return [];
    const db = this.ensureDb();
    const deduped = new Map<string, JobToPersist>();
    for (const job of jobs) {
      if (!job.url) continue;
      deduped.set(job.url, job);
    }
    if (deduped.size === 0) return [];

    try {
      const values = Array.from(deduped.values()).map((j) => ({
        url: j.url,
        nome_vaga: j.title,
        company: j.company || '',
        description: j.description || '',
      }));
      const inserted = await db
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

      this.logger.log(`💾 ${inserted.length} vagas persistidas no banco com Drizzle.`);
      return inserted.map((row) => this.toStoredRecord(row, true));
    } catch (error) {
      this.logger.error('Erro ao persistir vagas no banco com Drizzle:', error);
      throw error;
    }
  }

  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const db = this.ensureDb();
    await db.delete(sentJobs).where(inArray(sentJobs.id, ids));
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
