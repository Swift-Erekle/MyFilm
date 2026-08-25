import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['--test', 'test/live.test.js'], {
  cwd: process.cwd(),
  env: { ...process.env, RUN_LIVE_SCRAPER_TESTS: '1' },
  stdio: 'inherit',
});

child.once('error', error => {
  console.error(error);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) console.error(`Live scraper tests stopped by ${signal}`);
  process.exitCode = code ?? 1;
});
