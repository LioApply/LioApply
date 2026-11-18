export interface ApprovedJobDto {
  id?: number;
  title?: string;
  company?: string;
  score: number;
  reason: string;
  url: string;
  previewText: string;
}
