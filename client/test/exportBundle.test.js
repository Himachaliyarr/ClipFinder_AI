import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { createExportBundle } from '../src/utils/exportBundle.js';

test('creates a ZIP containing project formats and already-rendered clips', async () => {
  const archive = await createExportBundle({
    title: 'Doctor Sanjay',
    transcript: '',
    segments: [],
    projectFiles: {
      xml: new Blob(['<xmeml />']),
      edl: new Blob(['TITLE: Doctor Sanjay']),
      json: new Blob(['{"name":"Doctor Sanjay"}']),
    },
    renderedFiles: [{
      name: 'clip-1.mp4',
      blob: new Blob([new Uint8Array([0, 1, 2, 3])]),
    }],
  });
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));

  assert.equal(archive.type, 'application/zip');
  assert.equal(strFromU8(files['project/Doctor Sanjay-project.xml']), '<xmeml />');
  assert.equal(strFromU8(files['project/Doctor Sanjay-project.edl']), 'TITLE: Doctor Sanjay');
  assert.deepEqual([...files['renders/clip-1.mp4']], [0, 1, 2, 3]);
});

test('adds transcript formats, including a PDF, when transcript data is available', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {},
        fillText() {},
        measureText: text => ({ width: text.length * 10 }),
      }),
      toBlob: callback => callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })),
    }),
  };
  try {
    const archive = await createExportBundle({
      title: 'Doctor Sanjay',
      transcript: 'hello world',
      segments: [{ start: 0, end: 1, text: 'hello world' }],
      projectFiles: {},
      renderedFiles: [],
    });
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    assert.ok(files['transcript/Doctor Sanjay-transcript.txt']);
    assert.ok(files['transcript/Doctor Sanjay-transcript.json']);
    assert.ok(files['transcript/Doctor Sanjay-transcript.docx']);
    assert.ok(files['transcript/Doctor Sanjay-transcript.srt']);
    assert.ok(files['transcript/Doctor Sanjay-transcript.vtt']);
    assert.ok(strFromU8(files['transcript/Doctor Sanjay-transcript.pdf']).startsWith('%PDF-1.4'));
  } finally {
    globalThis.document = originalDocument;
  }
});
