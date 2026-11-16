import test from 'node:test';
import assert from 'node:assert/strict';
import { getRenderDimensions } from '../src/services/renderClip.js';

test('maps supported social formats to even render dimensions', () => {
  assert.deepEqual(getRenderDimensions('9:16'), { width: 1080, height: 1920 });
  assert.deepEqual(getRenderDimensions('1:1'), { width: 1080, height: 1080 });
  assert.deepEqual(getRenderDimensions('16:9'), { width: 1920, height: 1080 });
});

test('rejects unsupported render formats', () => {
  assert.throws(() => getRenderDimensions('4:3'), /Aspect ratio must be/);
});
