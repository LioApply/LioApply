import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { findExistingFile } from '../../config/yaml-config.loader';

const execFileAsync = promisify(execFile);

@Injectable()
export class TypstCompilerService {
  private readonly logger = new Logger(TypstCompilerService.name);

  resolveTypstBinary(): string {
    return (
      findExistingFile([
        process.env.TYPST_BIN,
        path.join(os.homedir(), '.local', 'bin', 'typst'),
        '/usr/local/bin/typst',
        '/usr/bin/typst',
      ]) || 'typst'
    );
  }

  async compileToPdfBuffer(typstSource: string): Promise<Buffer> {
    const tempId = randomUUID();
    const tmpDir = os.tmpdir();
    const inputTypPath = path.join(tmpDir, `cv-${tempId}.typ`);
    const outputPdfPath = path.join(tmpDir, `cv-${tempId}.pdf`);

    try {
      await fs.promises.writeFile(inputTypPath, typstSource, 'utf8');
      await execFileAsync(this.resolveTypstBinary(), ['compile', inputTypPath, outputPdfPath], { timeout: 15000 });
      const pdfBuffer = await fs.promises.readFile(outputPdfPath);
      this.logger.log(`📄 Currículo compilado com sucesso via Typst (${(pdfBuffer.length / 1024).toFixed(1)} KB).`);
      return pdfBuffer;
    } finally {
      await fs.promises.unlink(inputTypPath).catch(() => undefined);
      await fs.promises.unlink(outputPdfPath).catch(() => undefined);
    }
  }
}
