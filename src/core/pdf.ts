// 零依赖 PDF 生成器: 施工平面图按比例 + 图框图签, 支持多页批量
// 中文使用 PDF 内置 CID 字体 STSong-Light + UniGB-UCS2-H, 无需携带字体文件
// 内容流坐标: 内部统一以毫米建模, 输出时换算 PDF 点 (1mm = 2.83465pt)

export interface PdfText { x: number; y: number; size: number; text: string; bold?: boolean; }
export interface PdfLine { x1: number; y1: number; x2: number; y2: number; width: number; gray?: number; }
export interface PdfRect { x: number; y: number; w: number; h: number; width: number; fillGray?: number; }
export interface PdfCircle { x: number; y: number; r: number; width: number; fillGray?: number; }

export interface PdfPage {
  widthMm: number;
  heightMm: number;
  texts: PdfText[];
  lines: PdfLine[];
  rects: PdfRect[];
  circles: PdfCircle[];
}

const MM = 2.83464567;

class PdfWriter {
  private objects: string[] = [];
  private offsets: number[] = [];

  addObject(body: string): number {
    this.objects.push(body);
    return this.objects.length;
  }

  /** 中文/混合文本转 UTF-16BE 十六进制串 */
  private hexText(text: string): string {
    let out = '';
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      out += code.toString(16).padStart(4, '0');
    }
    return `<${out}>`;
  }

  private pageContent(page: PdfPage): string {
    const s: string[] = [];
    for (const l of page.lines) {
      s.push(`${(l.gray ?? 0).toFixed(2)} g`);
      s.push(`${l.width.toFixed(2)} w`);
      s.push(`${(l.x1 * MM).toFixed(2)} ${(l.y1 * MM).toFixed(2)} m ${(l.x2 * MM).toFixed(2)} ${(l.y2 * MM).toFixed(2)} l S`);
    }
    for (const r of page.rects) {
      const x = r.x * MM, y = r.y * MM, w = r.w * MM, h = r.h * MM;
      if (r.fillGray !== undefined) {
        s.push(`${r.fillGray.toFixed(2)} g`);
        s.push(`${x} ${y} ${w} ${h} re f`);
      }
      s.push(`0 g ${r.width.toFixed(2)} w ${x} ${y} ${w} ${h} re S`);
    }
    for (const c of page.circles) {
      const k = 0.5523;
      const x = c.x * MM, y = c.y * MM, r = c.r * MM;
      s.push(`${c.width.toFixed(2)} w`);
      s.push(`${x + r} ${y} m`);
      s.push(`${x + r} ${y + k * r} ${x + k * r} ${y + r} ${x} ${y + r} c`);
      s.push(`${x - k * r} ${y + r} ${x - r} ${y + k * r} ${x - r} ${y} c`);
      s.push(`${x - r} ${y - k * r} ${x - k * r} ${y - r} ${x} ${y - r} c`);
      s.push(`${x + k * r} ${y - r} ${x + r} ${y - k * r} ${x + r} ${y} c S`);
      if (c.fillGray !== undefined) { s.push(`${c.fillGray} g`); }
    }
    for (const t of page.texts) {
      s.push('BT');
      s.push(`/${t.bold ? 'F2' : 'F1'} ${(t.size * MM).toFixed(2)} Tf`);
      s.push(`${(t.x * MM).toFixed(2)} ${(t.y * MM).toFixed(2)} Td`);
      s.push(`${this.hexText(t.text)} Tj`);
      s.push('ET');
    }
    return s.join('\n');
  }

  build(pages: PdfPage[]): Uint8Array {
    // 字体对象: F1 常规 STSong-Light, F2 粗体 (同字体, 渲染侧加粗描边)
    const font1 = this.addObject('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [ << /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >> ] >>');
    const font2 = this.addObject('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [ << /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >> ] >>');
    const pageIds: number[] = [];
    for (const p of pages) {
      const content = this.pageContent(p);
      const contentId = this.addObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      const pageId = this.addObject(
        `<< /Type /Page /Parent PAGES_ID 0 R /MediaBox [0 0 ${(p.widthMm * MM).toFixed(2)} ${(p.heightMm * MM).toFixed(2)}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    }
    const pagesId = this.addObject(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    for (const id of pageIds) {
      this.objects[id - 1] = this.objects[id - 1].replace('PAGES_ID', String(pagesId));
    }
    const catalogId = this.addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    let pdf = '%PDF-1.4\n%\xff\xff\xff\xff\n';
    this.offsets = [];
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < this.objects.length; i++) {
      this.offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${this.objects[i]}\nendobj\n`;
    }
    const xrefPos = pdf.length;
    pdf += `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of this.offsets) pdf += `${off.toString().padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${this.objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
    chunks.push(encoder.encode(pdf));
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }
}

export interface TitleBlockInfo {
  projectName: string;
  drawingName: string;
  scale: string;
  sheetNo: string;
  designer: string;
  date: string;
}

/** 新建一页并绘制标准图框图签 (A3 横向 420×297) */
export function newSheet(title: TitleBlockInfo): PdfPage {
  const page: PdfPage = { widthMm: 420, heightMm: 297, texts: [], lines: [], rects: [], circles: [] };
  // 外框/内框
  page.rects.push({ x: 10, y: 10, w: 400, h: 277, width: 0.5 });
  page.rects.push({ x: 20, y: 20, w: 380, h: 257, width: 0.7 });
  // 标题栏 (右下角 180×40)
  const tx = 220, ty = 20, tw = 180, th = 40;
  page.rects.push({ x: tx, y: ty, w: tw, h: th, width: 0.7 });
  const rows = [ty + 10, ty + 20, ty + 30];
  for (const y of rows) page.lines.push({ x1: tx, y1: y, x2: tx + tw, y2: y, width: 0.4 });
  page.lines.push({ x1: tx + 70, y1: ty, x2: tx + 70, y2: ty + th, width: 0.4 });
  page.lines.push({ x1: tx + 125, y1: ty, x2: tx + 125, y2: ty + th, width: 0.4 });
  page.texts.push({ x: tx + 3, y: ty + 32, size: 4.5, text: '工程名称' });
  page.texts.push({ x: tx + 73, y: ty + 31, size: 5, bold: true, text: title.projectName });
  page.texts.push({ x: tx + 3, y: ty + 22, size: 4.5, text: '图名' });
  page.texts.push({ x: tx + 73, y: ty + 21, size: 5, bold: true, text: title.drawingName });
  page.texts.push({ x: tx + 3, y: ty + 12, size: 4.5, text: '比例' });
  page.texts.push({ x: tx + 30, y: ty + 12, size: 4.5, text: title.scale });
  page.texts.push({ x: tx + 73, y: ty + 12, size: 4.5, text: `设计:${title.designer}` });
  page.texts.push({ x: tx + 128, y: ty + 12, size: 4.5, text: `日期:${title.date}` });
  page.texts.push({ x: tx + 128, y: ty + 22, size: 4.5, text: `图号:${title.sheetNo}` });
  return page;
}

export function buildPdf(pages: PdfPage[]): Uint8Array {
  return new PdfWriter().build(pages);
}
