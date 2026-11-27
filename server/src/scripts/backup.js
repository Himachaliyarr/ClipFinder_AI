import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/settings.js';

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

const uri = config.mongodbUri;
if (!uri) throw new Error('MONGODB_URI is required to create a backup');

const backupRoot = config.backupRoot;
const mediaRoot = config.mediaRoot;
const backupRelativeToMedia = path.relative(mediaRoot, backupRoot);
if (backupRelativeToMedia === '' || (!path.isAbsolute(backupRelativeToMedia)
  && backupRelativeToMedia !== '..' && !backupRelativeToMedia.startsWith(`..${path.sep}`))) {
  throw new Error('BACKUP_ROOT must not be inside MEDIA_ROOT');
}

function redactError(error) {
  return String(error.message || 'Unknown backup error')
    .replace(/mongodb(?:\+srv)?:\/\/[^@\s]+@/gi, 'mongodb://[redacted]@')
    .slice(0, 500);
}

async function writeBackupStatus(update) {
  await fs.mkdir(backupRoot, { recursive: true });
  const statusPath = path.join(backupRoot, 'backup-status.json');
  let previous = {};
  try {
    previous = JSON.parse(await fs.readFile(statusPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const history = Array.isArray(previous.history) ? previous.history : [];
  if (update.status === 'success' || update.status === 'failed') {
    const eventTime = update.createdAt || update.failedAt || new Date().toISOString();
    history.push({
      id: `backup-${eventTime}`,
      status: update.status,
      createdAt: eventTime,
      error: update.error || null,
    });
  }
  const temporaryPath = `${statusPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify({ ...previous, ...update, history: history.slice(-30) }, null, 2), 'utf8');
  await fs.rm(statusPath, { force: true });
  await fs.rename(temporaryPath, statusPath);
}

async function createBackup() {
  await fs.mkdir(backupRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stagingDir = await fs.mkdtemp(path.join(backupRoot, `.clipfinder-backup-${timestamp}-`));
  const finalDir = path.join(backupRoot, `clipfinder-backup-${timestamp}`);

  try {
    await runMongoDump(uri, path.join(stagingDir, 'database.archive.gz'));
    let mediaIncluded = false;
    let mediaExists = true;
    try {
      await fs.access(mediaRoot);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      mediaExists = false;
    }
    if (mediaExists) {
      const uploadTempRoot = path.join(mediaRoot, '.upload-sessions');
      await fs.cp(mediaRoot, path.join(stagingDir, 'media'), {
        recursive: true,
        errorOnExist: true,
        filter: source => {
          const resolved = path.resolve(source);
          return resolved !== uploadTempRoot && !resolved.startsWith(`${uploadTempRoot}${path.sep}`);
        },
      });
      mediaIncluded = true;
    } else {
      console.log(`Media directory not found; database-only backup created (${mediaRoot})`);
    }
    const archive = await fs.stat(path.join(stagingDir, 'database.archive.gz'));
    const createdAt = new Date().toISOString();
    await fs.writeFile(path.join(stagingDir, 'backup-manifest.json'), JSON.stringify({
      createdAt,
      databaseArchive: 'database.archive.gz',
      databaseArchiveBytes: archive.size,
      mediaIncluded,
    }, null, 2), 'utf8');
    await fs.rename(stagingDir, finalDir);
    await writeBackupStatus({
      status: 'success',
      createdAt,
      backupFolder: path.basename(finalDir),
      databaseArchiveBytes: archive.size,
      mediaIncluded,
      failedAt: null,
      error: null,
    });
    console.log(JSON.stringify({ level: 'info', operation: 'backup', status: 'success', createdAt, mediaIncluded }));
    console.log(`Backup created at ${finalDir}`);
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    try {
      await writeBackupStatus({ status: 'failed', failedAt: new Date().toISOString(), error: redactError(error) });
    } catch (statusError) {
      console.error(JSON.stringify({ level: 'error', operation: 'write_backup_status', message: redactError(statusError) }));
    }
    throw error;
  }
}

if (process.argv.includes('--schedule')) {
  const intervalHours = config.backupIntervalHours;
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
    message: redactError(error),
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
