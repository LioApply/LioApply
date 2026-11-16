---
description: Project specs for context maintenance
---

# Project Documentation & Specifications — JobSearchBot

> **Project Goal:** Automated NestJS **one-shot pipeline** designed to scrape job opportunities from major platforms (LinkedIn, Indeed, Glassdoor) via Apify and Playwright, deduplicate postings by job title and company, process listings through TypeSafe Jev (System One AI semantic heuristic evaluation), and batch notify qualified junior/mid developer positions to WhatsApp via the Evolution API in a clean digest format. The container is scheduled externally by **Railway Cron** (every 1h) and exits after each run.

---

## 1. Architecture & Design Patterns

The project is built on **NestJS** and follows a **Clean Architecture / Service-Repository** modular pattern to ensure decoupling of data persistence, message formatting, business rules, and scraping orchestration.

### Directory Structure:
```text
packages/                  # Workspace package manifests (@lioapply/core, @lioapply/providers, @lioapply/cv, @lioapply/mcp)
src/
  ├── packages/
  │     ├── core/          # @lioapply/core (createLioApply SDK, LioApplyCoreModule, System-One Classifier, Deduplication)
  │     ├── providers/     # @lioapply/providers & subpath exports (@lioapply/providers/linkedin, /glassdoor, /remotar)
  │     ├── cv/            # @lioapply/cv (createCvEngine SDK & LioApplyCvModule for ATS CV optimization + Typst PDF)
  │     └── mcp/           # @lioapply/mcp (Official Model Context Protocol JSON-RPC 2.0 server over stdio)
  ├── database/
  │     └── schema.ts            # Drizzle ORM table definitions, constraints and indexes
  ├── interfaces/
  │     ├── isearch/             # LinkedIn search query definitions and shapes
  │     ├── glassdoor-search/    # Glassdoor search query definitions and shapes
  │     └── job-config/          # Declarative YAML search and user profile configuration shapes
  ├── config/
  │     ├── providers.ts         # Scraper provider builders and CSS selectors
  │     ├── yaml-config.loader.ts# Shared pure YAML/Base64/file loader helpers
  │     └── job-config.service.ts# Declarative YAML/ENV search, profile & classifier configuration loader (Config Layer)
  ├── services/
  │     ├── bot/                 # Orchestrator interface for browser scraping and messaging requests
  │     ├── cv/                  # On-demand ATS CV optimization (CvConfigService, Multi-provider LLM, Typst PDF compiler)
  │     ├── classifier/          # ClassifierService (orchestrator) + providers/ (Groq, Gemini, OpenRouter, Ollama, Jev)
  │     ├── scrapservice/        # Low-level HTTP integrations with Apify (LinkedIn)
  │     ├── glassdoor/           # Low-level HTTP integrations with Apify (Glassdoor)
  │     ├── whatsapp-service/    # Low-level integrations with the Evolution API
  │     └── task-service/        # One-shot pipeline execution & delegates
  │           ├── job-digest.formatter.ts   # Formatting (Presentation Layer)
  │           ├── job-history.repository.ts # Drizzle ORM PostgreSQL repository (Data Layer)
  │           └── task-service.service.ts   # Pipeline Orchestration (Application Layer)
  ├── main.ts                    # One-shot bootstrap: runs pipeline and exits
  └── utils/
        ├── deduplication.ts     # Title and company deduplication logic & injectable service
        └── jev.ts               # TypeSafe Jev evaluation primitives (Noul / fit)
```

### Core Architecture & SOLID Principles:
1. **Single Responsibility Principle (SRP):**
   - **`TaskService`**: Solely responsible for orchestrating the one-shot pipeline.
   - **`JobConfigService`**: Solely handles loading, parsing, and normalizing user search queries, semantic profiles, and classifier settings from `jobs.config.yaml` or `.env` (delegating provider location presets to `@lioapply/providers` via `resolveLocationPreset`).
   - **`CvConfigService`**: Solely handles CV optimization configuration and cached loading/parsing of `cv.base.yaml` / `CV_BASE_YAML` inside `@lioapply/cv`.
   - **`JobHistoryRepository`**: Solely handles persistent storage and querying of sent jobs using **Drizzle ORM**.
   - **`JobDeduplicationService`**: Solely handles title and company normalization and duplicate filtering.
   - **`ClassifierService` + `services/classifier/providers/*`**: `ClassifierService` reads `classifier` from `jobs.config.yaml` / `.env` and routes semantic job fit and CV evaluation to the chosen provider service (`GroqService`, `GeminiService`, `OpenRouterService`, `OllamaService`, `JevService`). Each provider only declares its defaults (URL, model, env keys) on top of `base.provider.ts`; HTTP clients live in `classifier-clients.ts`. Adding a provider = one new `*.service.ts` + registering it in `providers/index.ts`.
   - **`JobDigestFormatter`**: Solely formats and styles the WhatsApp alert messages (with `[#ID]` badges for on-demand CV generation).
   - **`CvOptimizationService` / `CvConfigService` / `CvLlmService` / `TypstTemplateService` / `TypstCompilerService`**: Handles on-demand ATS resume tailoring from `cv.base.yaml` using configurable LLM providers, semantic verification with TypeSafe Jev, ultra-fast PDF compilation via Typst (`typst` CLI), and direct PDF delivery to WhatsApp via Evolution API (`sendMediaDocument`).
   - **`ScrapserviceService`**: Handles low-level LinkedIn scraper HTTP request logic.
   - **`GlassdoorService`**: Handles low-level Glassdoor scraper HTTP request logic.
2. **Open-Closed Principle (OCP):**
   - Adding new scrapers (e.g. Indeed) can be done by creating a new service (like `GlassdoorService`) and adding it to `TaskService` without modifying the core deduplication repository or formatting logic.
3. **Dependency Injection (DI):**
   - All modules, services, and repositories are decoupled and resolved natively through NestJS IoC Container (`app.module.ts`).
4. **One-Shot Execution Model:**
   - `main.ts` uses `NestFactory.createApplicationContext()` (no HTTP server) to bootstrap DI, runs `TaskService.runScrapeJob()`, and calls `process.exit()` when done. Railway Cron handles the schedule externally (`0 * * * *` = every hour).

---

## 2. Business Rules

These core constraints govern the application's behavior and must **never** be violated:

1. **Persistent Deduplication by Title & Company:** 
   - Deduplication occurs by comparing the normalized **job title** and **company name**, never relying purely on the posting URL (which can vary between reposts and tracking links).
   - Before evaluating heuristics with Jev, the batch is deduplicated against recent history stored in PostgreSQL (`sent_jobs`) as well as within the current execution batch.
2. **Anti-Spam / Batch Notification (Digest):**
   - Individual WhatsApp message alerts are strictly prohibited to prevent WhatsApp number bans.
   - All qualified jobs within a single cron run must be consolidated into a single digest message.
   - If no new qualified jobs are found in a run, no message should be sent.
3. **Semantic Fit & Heuristic Scoring (TypeSafe Jev):**
   - Jobs are evaluated by Jev against target roles, tech stack, and allowed locations, returning calibrated probabilities via `Noul`.
   - The engine automatically penalizes senior positions/internships and verifies that posts are genuine hiring offers.

---

## 3. Contextual Awareness

Technical context, libraries, and coding guidelines:

- **Stack & Setup:** TypeScript (Strict mode), NestJS v11, Node.js (Fetch API), Docker & Docker Compose, Oracle VPS Cron (`run-bot.sh`), GitHub Actions CI/CD.
- **Execution Model:** One-shot standalone (no HTTP server). Executed on the Oracle VPS via `run-bot.sh` scheduled in crontab (with PostgreSQL and Evolution API running in Docker).
- **Environment Management:** 
   - The application loads configuration via NestJS `ConfigModule.forRoot()`.
   - Local development uses `.env` in the project root.
   - Key variables include `APIFY_URL` (LinkedIn, MUST point to a síncrono endpoint like `/run-sync-get-dataset-items`), `GLASSDOOR_APIFY_URL` (Glassdoor Apify actor), `EVOLUTION_API_URL`, `WHATSAPP_NUMBER` and `DATABASE_CONNECTION_URI` (PostgreSQL connection string).
- **Naming Conventions:**
   - Use `camelCase` for variable and function names.
   - Use `PascalCase` for class names, components, and controllers.
   - Suffix interfaces with `Dto` or `Interface` depending on their domain scope.

---

## 4. Workflows & Maintenance

Common commands and pipeline validation tasks:

- **Running Locally (one-shot):** 
  ```bash
  pnpm start:dev
  ```
  This will run the full pipeline once and exit.
- **Local Testing (manual trigger):**
  ```bash
  npx ts-node src/main.ts
  ```
- **On-Demand CV Optimization (CLI or WhatsApp):**
  ```bash
  pnpm cv <jobId_or_url_or_description>
  ```
  Or via WhatsApp by replying `/cv <ID>` (handled by `POST /webhook/evolution` when running `pnpm listen`).
- **Docker Production Deploy:**
  ```bash
  sudo docker compose up -d --build api
  ```
- **Oracle VPS CI/CD Deploy (GitHub Actions):**
  Pushing to `main` triggers `.github/workflows/ci-cd.yml`, which validates `pnpm run build` and `pnpm test` in CI, and if successful, connects via SSH to the Oracle VPS to pull `origin/main`, install dependencies, and compile `dist/main.js` for the next cron execution (`run-bot.sh`).
- **Railway Cron Deploy (Alternative):**
  Push to the connected branch — Railway will build the Docker image and schedule it via `railway.json` (`cronSchedule: "0 * * * *"`).
- **Documentation Rule:** Any new integrations (e.g. Indeed) or database changes must be immediately recorded here to preserve context for future pair programmers.

---

## 5. LioApply API Reference

### HTTP API (`pnpm run listen` / `AppController`)
When running in listener mode (`node dist/main.js --listen`), NestJS exposes the following HTTP endpoints:
- `GET /` — Health/greeting check (`AppService.getHello()`).
- `POST /instance/create` — Creates a WhatsApp instance on Evolution API (`CreateInstanceDto`).
- `GET /instance/connect/:instanceName` — Retrieves connection/QR status for an Evolution API instance.
- `POST /message/sendText/:instanceName` — Sends a WhatsApp text message (`SendMessageDTO`).
- `POST /webhook/evolution` — Evolution API webhook listener for on-demand `/cv <jobId>` or `/cv <url_or_description>` commands; generates the tailored Typst PDF and sends it back via WhatsApp.

### Programmatic SDK & NestJS DI (`@lioapply/*`)
- `@lioapply/core`: `createLioApply(options)` (`scrapeJobs`, `classifyJobs`, `searchAndClassify`, `buildSystemOneClassificationState`, `optimizeCv`) and `LioApplyCoreModule.register(options)` exporting `ClassifierService` and the 5 provider services.
- `@lioapply/providers`: `linkedin()`, `glassdoor()`, `remotar()`.
- `@lioapply/cv`: `typstCvEngine(options)` and `LioApplyCvModule.register()`.
- `@lioapply/mcp`: `pnpm run mcp` starts the JSON-RPC 2.0 MCP server over stdio.
