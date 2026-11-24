import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { strToU8, zipSync } from 'fflate';
import {
  formatTranscriptForExport,
  formatTranscriptJson,
  formatTranscriptSrt,
  formatTranscriptTimestamp,
  formatTranscriptVtt,
  getTranscriptLines,
} from './transcript.js';

const encoder = new TextEncoder();
const safeName = value => String(value || 'clipfinder')
  .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
  .trim() || 'clipfinder';

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not create transcript PDF page')), 'image/jpeg', 0.9);
  });
}

async function createTranscriptPdf(title, lines) {
  const width = 1190;
  const height = 1684;
  const margin = 96;
  const lineHeight = 42;
  const pages = [];
  let canvas;
  let context;
  let y;

  function startPage(withTitle) {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable for PDF export');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#111';
    context.font = '32px Arial, sans-serif';
    y = margin;
    if (withTitle) {
      context.font = 'bold 42px Arial, sans-serif';
      context.fillText(title || 'Transcript', margin, y);
      y += 72;
      context.font = '28px Arial, sans-serif';
    }
  }

  function addText(text) {
    const words = String(text).split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && context.measureText(candidate).width > width - margin * 2) {
        context.fillText(current, margin, y);
        y += lineHeight;
        current = word;
      } else {
        current = candidate;
      }
      if (y > height - margin) {
        pages.push(canvas);
        startPage(false);
      }
    }
    if (current) {
      context.fillText(current, margin, y);
      y += lineHeight;
    }
  }

  startPage(true);
  for (const line of lines) {
    addText(`[${formatTranscriptTimestamp(line.start)} - ${formatTranscriptTimestamp(line.end)}] ${line.text}`);
    y += 10;
    if (y > height - margin) {
      pages.push(canvas);
      startPage(false);
    }
  }
  pages.push(canvas);

  const pageImages = await Promise.all(pages.map(async page => new Uint8Array(await (await canvasBlob(page)).arrayBuffer())));
  const parts = [];
  const offsets = [0];
  let byteLength = 0;
  const append = bytes => {
    parts.push(bytes);
    byteLength += bytes.length;
  };
  const addObject = (id, body, stream) => {
    offsets[id] = byteLength;
    append(encoder.encode(`${id} 0 obj\n${body}`));
    if (stream) append(stream);
    append(encoder.encode('\nendobj\n'));
  };

  append(encoder.encode('%PDF-1.4\n'));
  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const pageIds = pageImages.map((_, index) => 3 + index * 3);
  addObject(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  pageImages.forEach((image, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    addObject(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    const stream = encoder.encode('q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ');
    addObject(contentId, `<< /Length ${stream.length} >>\nstream\n${new TextDecoder().decode(stream)}\nendstream`);
    offsets[imageId] = byteLength;
    append(encoder.encode(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`));
    append(image);
    append(encoder.encode('\nendstream\nendobj\n'));
  });
  const xrefOffset = byteLength;
  append(encoder.encode(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return new Blob(parts, { type: 'application/pdf' });
}

export async function createExportBundle({ title, transcript, segments, projectFiles, renderedFiles }) {
  const filename = safeName(title);
  const files = {};
  for (const [extension, content] of Object.entries(projectFiles)) {
    files[`project/${filename}-project.${extension}`] = new Uint8Array(await content.arrayBuffer());
  }
  for (const renderedFile of renderedFiles) {
    files[`renders/${safeName(renderedFile.name)}`] = new Uint8Array(await renderedFile.blob.arrayBuffer());
  }

  if (transcript) {
    const lines = getTranscriptLines(segments);
    const rows = lines.length
      ? lines.map(line => ({
          start: `${formatTranscriptTimestamp(line.start)} - ${formatTranscriptTimestamp(line.end)}`,
          text: line.text,
        }))
      : [{ start: '', text: transcript }];
    const paragraphs = [
      new Paragraph({ text: title || 'Transcript', heading: HeadingLevel.TITLE }),
      ...rows.map(row => new Paragraph({
        children: [
          ...(row.start ? [new TextRun({ text: `[${row.start}] `, bold: true })] : []),
          new TextRun(row.text),
        ],
      })),
    ];
    const docx = await Packer.toBlob(new Document({ sections: [{ children: paragraphs }] }));
    files[`transcript/${filename}-transcript.txt`] = strToU8(`\uFEFF${formatTranscriptForExport(transcript, segments)}`);
    files[`transcript/${filename}-transcript.json`] = strToU8(formatTranscriptJson(title, transcript, segments));
    files[`transcript/${filename}-transcript.docx`] = new Uint8Array(await docx.arrayBuffer());
    const pdfLines = lines.length ? lines : [{ start: 0, end: 0, text: transcript }];
    files[`transcript/${filename}-transcript.pdf`] = new Uint8Array(await (await createTranscriptPdf(title, pdfLines)).arrayBuffer());
    if (lines.length) {
      files[`transcript/${filename}-transcript.srt`] = strToU8(formatTranscriptSrt(segments));
      files[`transcript/${filename}-transcript.vtt`] = strToU8(formatTranscriptVtt(segments));
    }
  }

  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}
