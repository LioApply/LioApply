import { Injectable } from '@nestjs/common';
import {
  BaseCvData,
  CvEducationItem,
  CvExperienceItem,
  CvLanguageItem,
  CvProjectItem,
  CvSectionTitles,
  CvTailoredPatchDto,
  CvTechnologies,
} from '../../interfaces/cv/cv.interface';
import {
  SECTION_TITLES_BY_LANG,
  SupportedCvLanguage,
  TECH_LABELS_BY_LANG,
} from './prompts/cv-ats.prompt';

const DEFAULT_SECTION_TITLES: CvSectionTitles = SECTION_TITLES_BY_LANG.pt;

const TECH_LABELS: Array<[keyof CvTechnologies, string]> = [
  ['languages', 'Linguagens'],
  ['frontend', 'Frontend'],
  ['backend', 'Backend'],
  ['databases', 'Bancos de Dados'],
  ['devops', 'Cloud & DevOps'],
  ['aiAndTools', 'IA & Ferramentas'],
  ['practices', 'Práticas'],
];

const TYPST_SPECIAL_CHARS = /[\\#*_$@<>`[\]~]/g;

const TYPST_LAYOUT = `#set page(paper: "a4", margin: (top: 1.5cm, bottom: 1.5cm, left: 1.6cm, right: 1.6cm))
#set text(font: ("Liberation Serif", "DejaVu Serif", "Linux Libertine", "Times New Roman"), size: 10pt, fill: rgb("#000000"))
#set par(justify: false, leading: 0.52em)

#let section-header(title) = {
  v(6pt)
  text(size: 11pt, weight: "regular")[#smallcaps[#title]]
  v(-6pt)
  line(length: 100%, stroke: 0.5pt + rgb("#000000"))
  v(2pt)
}

#let twocol(left-content, right-content) = {
  grid(columns: (1fr, auto), column-gutter: 12pt, align: (left, right), left-content, right-content)
}`;

const sanitizeFilePart = (value: string, fallback: string): string =>
  (value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 35);

export const buildSafePdfFileName = (candidateName: string, targetSuffix: string): string =>
  `Curriculo_${sanitizeFilePart(candidateName, 'Candidato')}_${sanitizeFilePart(targetSuffix, 'Vaga')}.pdf`;

const nonEmpty = (val: string | undefined, fallback?: string): string | undefined =>
  val?.trim() ? val.trim() : fallback;

const nonEmptyArr = <T>(val: T[] | undefined, fallback: T[]): T[] =>
  Array.isArray(val) && val.length > 0 ? val : fallback;

@Injectable()
export class TypstTemplateService {
  escapeTypst(value: string | undefined | null): string {
    return value ? String(value).replace(TYPST_SPECIAL_CHARS, (ch) => `\\${ch}`).trim() : '';
  }

  escapeTypstStringLiteral(value: string | undefined | null): string {
    return value
      ? String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').trim()
      : '';
  }

  /** Preserves immutable fields (name, contact) while applying tailored/translated sections. */
  mergeBaseWithPatch(
    baseCv: BaseCvData,
    patch?: Partial<CvTailoredPatchDto>,
    targetLanguage?: SupportedCvLanguage,
  ): BaseCvData {
    if (!patch) return baseCv;
    const lang = targetLanguage || 'pt';
    const langTitles = SECTION_TITLES_BY_LANG[lang];
    const langTechLabels = TECH_LABELS_BY_LANG[lang];
    const keepBaseLabels = lang === 'pt';

    return {
      name: baseCv.name,
      contact: { ...baseCv.contact },
      education: nonEmptyArr(patch.education, baseCv.education),
      languages: nonEmptyArr(patch.languages, baseCv.languages),
      certifications: nonEmptyArr(patch.certifications, baseCv.certifications || []),
      headline: nonEmpty(patch.headline, baseCv.headline),
      summary: nonEmpty(patch.summary, baseCv.summary)!,
      experience: nonEmptyArr(patch.experience, baseCv.experience),
      projects: nonEmptyArr(patch.projects, baseCv.projects),
      technologies:
        patch.technologies && Object.keys(patch.technologies).length > 0
          ? { ...baseCv.technologies, ...patch.technologies }
          : baseCv.technologies,
      techLabels: {
        ...langTechLabels,
        ...(keepBaseLabels ? baseCv.techLabels : undefined),
        ...patch.techLabels,
      },
      sectionTitles: {
        ...langTitles,
        ...(keepBaseLabels ? baseCv.sectionTitles : undefined),
        ...patch.sectionTitles,
      },
    };
  }

  renderTypstDocument(
    cvData: BaseCvData,
    jobMetadata?: { title?: string; company?: string; language?: SupportedCvLanguage },
  ): string {
    const fallbackTitles = jobMetadata?.language ? SECTION_TITLES_BY_LANG[jobMetadata.language] : DEFAULT_SECTION_TITLES;
    const titles: CvSectionTitles = { ...fallbackTitles, ...cvData.sectionTitles };
    const docTitle = jobMetadata?.title ? `${cvData.name} - ${jobMetadata.title}` : `${cvData.name} - Currículo`;

    const contactParts: string[] = [];
    if (cvData.contact?.email) {
      const emailUrl = `mailto:${this.escapeTypstStringLiteral(cvData.contact.email)}`;
      contactParts.push(`#underline[#link("${emailUrl}")[${this.escapeTypst(cvData.contact.email)}]]`);
    }
    if (cvData.contact?.phone) contactParts.push(this.escapeTypst(cvData.contact.phone));
    for (const url of [cvData.contact?.linkedin, cvData.contact?.github, cvData.contact?.website]) {
      if (url) contactParts.push(this.formatContactLink(url));
    }

    const headlineLine = cvData.headline
      ? `\n  #v(-4pt)\n  #text(size: 10pt)[${this.escapeTypst(cvData.headline)}]`
      : '';

    const section = (title: string | undefined, body: string) =>
      `#section-header("${this.escapeTypstStringLiteral(title)}")\n${body}`;

    return [
      `#set document(title: "${this.escapeTypstStringLiteral(docTitle)}", author: "${this.escapeTypstStringLiteral(cvData.name)}")`,
      TYPST_LAYOUT,
      `#align(center)[\n  #text(size: 22pt, weight: "bold")[${this.escapeTypst(cvData.name)}]${headlineLine}\n  #v(-3pt)\n  #text(size: 9.5pt)[${contactParts.join(' | ')}]\n]\n#v(2pt)`,
      section(titles.summary, this.escapeTypst(cvData.summary)),
      section(titles.experience, this.renderExperience(cvData.experience || [])),
      section(titles.projects, this.renderProjects(cvData.projects || [])),
      section(titles.education, this.renderEducation(cvData.education || [])),
      section(titles.technologies, this.renderTechnologies(cvData.technologies || {}, cvData.techLabels)),
      section(titles.languages, this.renderCertificationsAndLanguages(cvData.certifications || [], cvData.languages || [])),
    ].join('\n\n') + '\n';
  }

  private renderBullets(items?: string[]): string {
    return (items || []).filter(Boolean).map((b) => `- ${this.escapeTypst(b)}`).join('\n');
  }

  private renderExperience(items: CvExperienceItem[]): string {
    return items
      .map(
        (exp) =>
          `#twocol([*${this.escapeTypst(exp.title)}*], [${this.escapeTypst(exp.dates)}])\n#v(-4pt)\n#twocol([_${this.escapeTypst(exp.company)}_], [_${this.escapeTypst(exp.location)}_])\n#v(-2pt)\n${this.renderBullets(exp.description)}\n#v(4pt)`,
      )
      .join('\n\n');
  }

  private renderProjects(items: CvProjectItem[]): string {
    return items
      .map((proj) => {
        let titlePart = `*${this.escapeTypst(proj.name)}*`;
        if (proj.techStack) {
          titlePart += ` | _${this.escapeTypst(proj.techStack)}_`;
        } else if (proj.link) {
          const href = proj.link.startsWith('http') ? proj.link : `https://${proj.link}`;
          titlePart += ` | #link("${this.escapeTypstStringLiteral(href)}")[GitHub]`;
        }
        return `#twocol([${titlePart}], [${this.escapeTypst(proj.dates)}])\n#v(-2pt)\n${this.renderBullets(proj.description)}\n#v(3pt)`;
      })
      .join('\n\n');
  }

  private renderEducation(items: CvEducationItem[]): string {
    return items
      .map(
        (edu) =>
          `#twocol([*${this.escapeTypst(edu.institution)}*], [${edu.location ? this.escapeTypst(edu.location) : ''}])\n#v(-4pt)\n#twocol([_${this.escapeTypst(edu.degree)}_], [_${this.escapeTypst(edu.dates)}_])`,
      )
      .join('\n#v(3pt)\n');
  }

  private formatContactLink(rawUrl: string): string {
    const clean = rawUrl.replace(/^https?:\/\/(www\.)?/, '');
    const href = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    return `#underline[#link("${this.escapeTypstStringLiteral(href)}")[${this.escapeTypst(clean)}]]`;
  }

  private renderTechnologies(
    tech: CvTechnologies,
    customLabels?: Partial<Record<keyof CvTechnologies, string>>,
  ): string {
    return TECH_LABELS.filter(([key]) => Boolean(tech[key]))
      .map(([key, defaultLabel]) => `*${this.escapeTypst(customLabels?.[key] || defaultLabel)}:* ${this.escapeTypst(tech[key])}`)
      .join(' \\\n');
  }

  private renderCertificationsAndLanguages(certifications: string[], items: CvLanguageItem[]): string {
    const lines = certifications.map((cert) => {
      const [head, ...rest] = cert.split('–');
      return rest.length > 0
        ? `*${this.escapeTypst(head.trim())}* – ${this.escapeTypst(rest.join('–').trim())}`
        : this.escapeTypst(cert);
    });

    if (items.length > 0) {
      lines.push(items.map((l) => `*${this.escapeTypst(l.language)}:* ${this.escapeTypst(l.level)}`).join(' | '));
    }
    return lines.join(' \\\n');
  }
}
