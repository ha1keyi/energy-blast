import { spawn } from 'child_process';
import { join } from 'path';

console.log('Starting Energy Blast...');
console.log('Starting Server...');

const server = spawn('npm', ['start'], {
    cwd: join(process.cwd(), 'server'),
    shell: true,
    stdio: 'inherit'
});

console.log('Starting Client...');

const client = spawn('npm', ['run', 'dev'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'inherit'
});

const cleanup = () => {
    console.log('Stopping processes...');
    server.kill();
    client.kill();
    process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
