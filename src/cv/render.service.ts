import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium } from 'playwright';
import { AppError } from '../common/errors';

const PAGE_MARKER = /\/Type\s*\/Page[^s]/g;

/**
 * One Chromium instance per command run — Nest tears this down via
 * onModuleDestroy when the CLI's app context closes after the command finishes.
 */
@Injectable()
export class RenderService implements OnModuleDestroy {
  private browser?: Promise<Browser>;

  async renderPdf(html: string, paper: 'A4' | 'Letter'): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({
        format: paper,
        printBackground: false,
        margin: { top: '0.5in', bottom: '0.5in', left: '0.6in', right: '0.6in' },
      });
    } finally {
      await page.close();
    }
  }

  countPages(pdf: Buffer): number {
    const matches = pdf.toString('latin1').match(PAGE_MARKER);
    return matches ? matches.length : 0;
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = chromium.launch().catch((err) => {
        this.browser = undefined;
        throw new AppError(
          'RENDER_FAILED',
          `Chromium is not installed. Run: npx playwright install chromium\n(${(err as Error).message})`,
        );
      });
    }
    return this.browser;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      const browser = await this.browser.catch(() => undefined);
      await browser?.close();
    }
  }
}
