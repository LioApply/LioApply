# Changelog

All notable changes to **LioApply** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-17

### Added
- **Multi-provider job scraping & pipeline (`@lioapply/core`, `@lioapply/providers`):** LinkedIn, Glassdoor and Remotar scraping with persistent title/company deduplication in PostgreSQL (Drizzle ORM).
- **Semantic job classification:** Configurable provider routing (`groq`, `gemini`, `openrouter`, `ollama`, `jev` / System-One) via `jobs.config.yaml` and `.env`.
- **WhatsApp digest & listener (`Evolution API`):** Anti-ban single-batch job digest notifications and `/webhook/evolution` listener for on-demand `/cv` commands.
- **ATS CV optimization engine (`@lioapply/cv`):** Typst PDF compilation, LLM-tailored resume generation from `cv.base.yaml`, Playwright HTML/JSON-LD extraction for job URLs, and deterministic job-language adaptation (`pt`, `en`, `es`).
- **MCP Server (`@lioapply/mcp`):** JSON-RPC 2.0 server over stdio (`--mcp`).
