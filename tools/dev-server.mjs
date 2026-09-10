import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsHide: false,
});

let shuttingDown = false;

function finish(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    if (process.platform === 'win32' && child.pid) {
        execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => process.exit(code));
        return;
    }

    child.kill('SIGTERM');
    process.exit(code);
}

child.on('error', error => {
    console.error(error.message);
    finish(1);
});

child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exit(code ?? (signal ? 1 : 0));
});

process.on('SIGINT', () => finish(0));
process.on('SIGTERM', () => finish(0));
process.on('exit', () => {
    if (!shuttingDown && child.pid && process.platform !== 'win32') child.kill('SIGTERM');
});
