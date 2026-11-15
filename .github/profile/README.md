<p align="center">
  <img width="1600" height="400" alt="readme-banner" src="https://github.com/user-attachments/assets/39cac228-a045-4346-ace1-72122fc7ab49" />
</p>

<h1 align="center">🦁 LioApply</h1>

<p align="center">
  <strong>Automação Open-Source de Busca de Vagas, Classificação Semântica System-One e Currículos ATS em PDF (via Typst & WhatsApp)</strong>
</p>

<p align="center">
  <a href="https://github.com/LioApply/LioApply"><img src="https://img.shields.io/badge/Reposit%C3%B3rio-LioApply%2FLioApply-f59e0b?style=flat-square&logo=github" alt="Repository" /></a>
  <a href="https://github.com/LioApply/LioApply#readme"><img src="https://img.shields.io/badge/Documenta%C3%A7%C3%A3o-Quick_Start-10b981?style=flat-square&logo=readthedocs&logoColor=white" alt="Docs" /></a>
  <a href="https://github.com/orgs/LioApply/projects/1"><img src="https://img.shields.io/badge/Roadmap-GitHub_Projects-3b82f6?style=flat-square&logo=github" alt="Roadmap" /></a>
  <a href="https://github.com/LioApply/LioApply/blob/main/LICENSE"><img src="https://img.shields.io/badge/Licen%C3%A7a-MIT-a855f7?style=flat-square" alt="License" /></a>
</p>

---

## Sobre o Projeto

O **LioApply** é uma plataforma **100% Open-Source e gratuita** construída em **NestJS + TypeScript** para engenheiros de software que desejam automatizar toda a esteira de busca e candidatura a vagas:

- **🔍 Scraping Multi-Plataforma:** Coleta vagas no **LinkedIn**, **Glassdoor** e **Remotar** via Playwright Stealth e Apify, configurado declarativamente via [`jobs.config.yaml`](https://github.com/LioApply/LioApply/blob/main/jobs.config.example.yaml).
- **🧹 Deduplicação Inteligente:** Filtra vagas repetidas normalizando **título + empresa** no PostgreSQL (Drizzle ORM).
- **🧠 Classificador Semântico System-One Multi-Provider:** Avalia vagas em lote usando probabilidades calibradas (`noul`) com compressão de rubricas (~80% de economia de tokens), compatível com **Groq**, **Google Gemini**, **OpenRouter**, **Ollama** e **TypeSafe Jev**.
- **📄 Currículo ATS Sob Demanda (`/cv` + Typst PDF):** Responda `/cv <ID>` no WhatsApp (ou `pnpm cv <ID>` no terminal) para adaptar seu currículo base (`cv.base.yaml`) às palavras-chave da vaga e receber o PDF compilado via **Typst** em milissegundos.
- **🔌 Servidor MCP Oficial (`@lioapply/mcp`):** Conecte o LioApply diretamente ao Claude Desktop, Cursor ou Antigravity via JSON-RPC 2.0 (`stdio`).

---

## 📦 Ecossistema de Pacotes (`@lioapply/*`)

| Pacote | Descrição |
| :--- | :--- |
| [`@lioapply/core`](https://github.com/LioApply/LioApply/tree/main/src/packages/core) | Motor principal, pipeline declarativo, deduplicação e `ClassifierService` multi-provider. |
| [`@lioapply/providers`](https://github.com/LioApply/LioApply/tree/main/src/packages/providers) | Scrapers modulares injetáveis (`linkedin`, `glassdoor`, `remotar`). |
| [`@lioapply/cv`](https://github.com/LioApply/LioApply/tree/main/src/packages/cv) | Motor de otimização de currículo ATS + compilador PDF Typst (`typstCvEngine`). |
| [`@lioapply/mcp`](https://github.com/LioApply/LioApply/tree/main/src/packages/mcp) | Servidor Model Context Protocol oficial exportando as ferramentas do LioApply. |

---

## 🔗 Links Rápidos

- 📚 **[Documentação & Guia de Instalação](https://github.com/LioApply/LioApply#readme)**
- 💻 **[Repositório Principal (`LioApply/LioApply`)](https://github.com/LioApply/LioApply)**
- 🗺️ **[Roadmap & Issues (`GitHub Projects`)](https://github.com/orgs/LioApply/projects/1)**
- 🐛 **[Reportar Bug ou Sugerir Feature](https://github.com/LioApply/LioApply/issues)**
