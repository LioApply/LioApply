export type CvCommand = { type: 'jobId'; jobId: number } | { type: 'custom'; input: string };

export interface ParsedEvolutionWebhook {
  fromMe: boolean;
  text: string;
  /** Digits-only phone number extracted from `key.remoteJid` (undefined when not a user JID). */
  senderNumber?: string;
  instance?: string;
}
