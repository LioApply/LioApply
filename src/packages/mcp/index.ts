import * as path from 'path';
import * as readline from 'readline';
import { LioApplyOptions, NormalizedCandidateJob, createLioApply } from '../core';
import { typstCvEngine } from '../cv';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const CANDIDATES_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      description: 'List of candidate jobs returned by lioapply_search_jobs.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          text: { type: 'string' },
          location: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['title', 'text', 'url'],
      },
    },
  },
  required: ['candidates'],
};

export const LIOAPPLY_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'lioapply_search_jobs',
    description:
      'Scrapes job listings from selected providers (linkedin, glassdoor, remotar) and deduplicates them by normalized title and company.',
    inputSchema: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' }, description: 'Optional search queries override (defaults to jobs.config.yaml).' },
        providers: { type: 'array', items: { type: 'string', enum: ['linkedin', 'glassdoor', 'remotar'] }, description: 'Optional list of providers to run.' },
      },
    },
  },
  {
    name: 'lioapply_get_classification_rubric',
    description:
      'Returns the System-One { state, questions, thresholds } Noul rubric and user profile criteria for host classification without external API calls.',
    inputSchema: CANDIDATES_INPUT_SCHEMA,
  },
  {
    name: 'lioapply_classify_jobs',
    description:
      'Evaluates candidate jobs in batch using the configured System-One Multi-Provider classifier (openrouter, groq, gemini, ollama, or jev).',
    inputSchema: CANDIDATES_INPUT_SCHEMA,
  },
  {
    name: 'lioapply_optimize_cv',
    description:
      'Generates a tailored, ATS-optimized PDF resume from cv.base.yaml for a specific job using OpenRouter and Typst.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Target job title.' },
        company: { type: 'string', description: 'Target company name (optional).' },
        description: { type: 'string', description: 'Full job description or requirements.' },
        outputPath: { type: 'string', description: 'Optional output file path for the generated PDF (defaults to ./result/<fileName>).' },
      },
      required: ['title', 'description'],
    },
  },
];

const textResult = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

/** `@lioapply/mcp`: Official MCP Server over `@lioapply/core`, `@lioapply/providers`, and `@lioapply/cv`. */
export function createLioApplyMcpServer(options?: LioApplyOptions) {
  const lio = createLioApply({
    ...options,
    cv: options?.cv || typstCvEngine({ outputDir: path.resolve(process.cwd(), 'result') }),
  });

  return {
    lio,
    listTools: (): McpToolDefinition[] => LIOAPPLY_MCP_TOOLS,

    async callTool(name: string, args: Record<string, any> = {}) {
      const candidates = (args.candidates || []) as NormalizedCandidateJob[];

      switch (name) {
        case 'lioapply_search_jobs':
          return textResult(
            await lio.scrapeJobs({
              queries: Array.isArray(args.queries) ? args.queries : undefined,
              providers: Array.isArray(args.providers) ? args.providers : undefined,
            }),
          );

        case 'lioapply_get_classification_rubric':
          return textResult(lio.buildSystemOneClassificationState(candidates));

        case 'lioapply_classify_jobs':
          return textResult({ approvedJobs: await lio.classifyJobs(candidates) });

        case 'lioapply_optimize_cv': {
          const res = await lio.optimizeCv({
            title: String(args.title || 'Desenvolvedor de Software'),
            company: args.company ? String(args.company) : undefined,
            description: String(args.description || ''),
            outputPath: args.outputPath ? String(args.outputPath) : undefined,
          });
          return textResult({
            fileName: res.fileName,
            savedFilePath: res.savedFilePath,
            pdfSizeBytes: res.pdfBuffer.length,
            evaluation: res.evaluation,
          });
        }

        default:
          throw new Error(`MCP Tool desconhecida: ${name}`);
      }
    },

    async handleJsonRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
      if (request.id === undefined) return null;

      const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: request.id!, result });
      const fail = (code: number, message: string): JsonRpcResponse => ({
        jsonrpc: '2.0',
        id: request.id!,
        error: { code, message },
      });

      try {
        switch (request.method) {
          case 'initialize':
            return ok({
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: '@lioapply/mcp', version: '0.1.0' },
            });
          case 'ping':
            return ok({});
          case 'tools/list':
            return ok({ tools: this.listTools() });
          case 'tools/call':
            return ok(await this.callTool(request.params?.name, request.params?.arguments || {}));
          default:
            return fail(-32601, `Method not found: ${request.method}`);
        }
      } catch (err: any) {
        return fail(-32000, err?.message || String(err));
      }
    },

    startStdio(): void {
      const rl = readline.createInterface({ input: process.stdin, terminal: false });
      rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const res = await this.handleJsonRpcRequest(JSON.parse(trimmed) as JsonRpcRequest);
          if (res) process.stdout.write(JSON.stringify(res) + '\n');
        } catch (err: any) {
          process.stdout.write(
            JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${err?.message || err}` } }) + '\n',
          );
        }
      });
    },
  };
}
