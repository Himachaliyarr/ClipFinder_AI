import '../../config/env.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const backupRoot = path.resolve(process.env.BACKUP_ROOT || './backups');
const discard = new Writable({ write(chunk, encoding, callback) { callback(); } });

async function updateStatus(update) {
  await fs.mkdir(backupRoot, { recursive: true });
  const statusPath = path.join(backupRoot, 'backup-status.json');
  let previous = {};
  try {
    previous = JSON.parse(await fs.readFile(statusPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const temporaryPath = `${statusPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify({ ...previous, ...update }, null, 2), 'utf8');
  await fs.rm(statusPath, { force: true });
  await fs.rename(temporaryPath, statusPath);
}

async function verifyLatestBackup() {
  const entries = await fs.readdir(backupRoot, { withFileTypes: true });
  const folders = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('clipfinder-backup-'))
    .map(entry => path.join(backupRoot, entry.name))
    .sort()
    .reverse();
  if (!folders.length) throw new Error('No backup folders were found');

  const backupFolder = folders[0];
  const manifest = JSON.parse(await fs.readFile(path.join(backupFolder, 'backup-manifest.json'), 'utf8'));
  if (manifest.databaseArchive !== 'database.archive.gz') throw new Error('Backup manifest references an unexpected database archive');
  const archivePath = path.join(backupFolder, manifest.databaseArchive);
  const archive = await fs.stat(archivePath);
  if (!archive.isFile() || archive.size !== manifest.databaseArchiveBytes) {
    throw new Error('Database archive size does not match the backup manifest');
  }
  await pipeline(createReadStream(archivePath), createGunzip(), discard);
  if (manifest.mediaIncluded) {
    const media = await fs.stat(path.join(backupFolder, 'media'));
    if (!media.isDirectory()) throw new Error('Backed-up media directory is missing');
  }
  return {
    checkedAt: new Date().toISOString(),
    ok: true,
    backupFolder: path.basename(backupFolder),
    databaseArchiveBytes: archive.size,
    mediaIncluded: Boolean(manifest.mediaIncluded),
    method: 'gzip integrity and media-directory presence',
    restoreTested: false,
  };
}

try {
  const verification = await verifyLatestBackup();
  await updateStatus({ lastVerification: verification });
  console.log(JSON.stringify({ level: 'info', operation: 'backup_verification', ...verification }));
} catch (error) {
  const verification = {
    checkedAt: new Date().toISOString(),
    ok: false,
    error: String(error.message || 'Backup verification failed').slice(0, 500),
    restoreTested: false,
  };
  await updateStatus({ lastVerification: verification });
  console.error(JSON.stringify({ level: 'error', operation: 'backup_verification', ...verification }));
  process.exitCode = 1;
}
