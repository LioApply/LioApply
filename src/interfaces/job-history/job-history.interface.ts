export interface StoredJobRecord {
  id?: number;
  url: string;
  title: string;
  company?: string;
  description?: string;
  sent_at?: Date;
}

export interface JobToPersist {
  url: string;
  title: string;
  company?: string;
  description?: string;
}
