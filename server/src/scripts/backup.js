import '../../config/env.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

function runMongoDump(uri, archivePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('mongodump', ['--uri', uri, `--archive=${archivePath}`, '--gzip'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on('error', error => reject(new Error(`Could not start mongodump: ${error.message}`)));
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`mongodump exited with code ${code}: ${stderr.trim() || 'No diagnostic output'}`));
    });
  });
}

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required to create a backup');

const backupRoot = path.resolve(process.env.BACKUP_ROOT || './backups');
const mediaRoot = path.resolve(process.env.MEDIA_ROOT || './server/storage');
const backupRelativeToMedia = path.relative(mediaRoot, backupRoot);
if (backupRelativeToMedia === '' || (!path.isAbsolute(backupRelativeToMedia)
  && backupRelativeToMedia !== '..' && !backupRelativeToMedia.startsWith(`..${path.sep}`))) {
  throw new Error('BACKUP_ROOT must not be inside MEDIA_ROOT');
}

async function createBackup() {
  await fs.mkdir(backupRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stagingDir = await fs.mkdtemp(path.join(backupRoot, `.clipfinder-backup-${timestamp}-`));
  const finalDir = path.join(backupRoot, `clipfinder-backup-${timestamp}`);

  try {
    await runMongoDump(uri, path.join(stagingDir, 'database.archive.gz'));
    try {
      await fs.access(mediaRoot);
      await fs.cp(mediaRoot, path.join(stagingDir, 'media'), { recursive: true, errorOnExist: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      console.log(`Media directory not found; database-only backup created (${mediaRoot})`);
    }
    await fs.rename(stagingDir, finalDir);
    console.log(`Backup created at ${finalDir}`);
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv.includes('--schedule')) {
  const intervalHours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  if (!Number.isFinite(intervalHours) || intervalHours <= 0 || intervalHours > 24 * 30) {
    throw new Error('BACKUP_INTERVAL_HOURS must be greater than 0 and no more than 720');
  }
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const wait = async milliseconds => {
    const maxTimerDelay = 2_147_000_000;
    while (milliseconds > 0) {
      const delay = Math.min(milliseconds, maxTimerDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
      milliseconds -= delay;
    }
  };
  const reportFailure = error => console.error(JSON.stringify({
    level: 'error',
    operation: 'scheduled_backup',
    message: error.message,
  }));
  await createBackup();
  while (true) {
    await wait(intervalMs);
    try {
      await createBackup();
    } catch (error) {
      reportFailure(error);
    }
  }
} else {
  await createBackup();
}
