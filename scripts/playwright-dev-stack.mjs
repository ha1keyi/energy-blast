import { spawn } from 'child_process';
import { createServer } from 'http';

const host = process.env.HOST || '127.0.0.1';
const appPort = Number(process.env.PW_APP_PORT || 33173);
const serverPort = Number(process.env.PW_SERVER_PORT || 33100);
const stackPort = Number(process.env.PW_STACK_PORT || 33400);

let shuttingDown = false;
let readyServer;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // Service is still starting.
        }

        await wait(500);
    }

    throw new Error(`Timed out waiting for ${url}`);
}

function prefixStream(stream, prefix) {
    stream.on('data', (chunk) => {
        process.stdout.write(`${prefix}${chunk}`);
    });
}

function spawnChild(command, args, extraEnv = {}) {
    const child = spawn(command, args, {
        cwd: process.cwd(),
        shell: true,
        env: {
            ...process.env,
            ...extraEnv,
        },
    });

    prefixStream(child.stdout, '');
    prefixStream(child.stderr, '');
    child.on('exit', (code) => {
        if (shuttingDown) return;
        console.error(`Child process exited early: ${command} ${args.join(' ')} (${code ?? 'null'})`);
        process.exit(code ?? 1);
    });
    return child;
}

const serverProcess = spawnChild('node', ['server/server.js'], {
    HOST: host,
    PORT: String(serverPort),
});

const appProcess = spawnChild('npm', ['run', 'dev', '--', '--host', host, '--port', String(appPort)], {
    VITE_SERVER_URL: `http://${host}:${serverPort}`,
});

async function main() {
    await waitForHttp(`http://${host}:${serverPort}/health`);
    await waitForHttp(`http://${host}:${appPort}`);

    readyServer = createServer((req, res) => {
        if (req.url === '/ready') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        res.writeHead(404);
        res.end('not found');
    });

    readyServer.listen(stackPort, host, () => {
        console.log(`Playwright stack ready at http://${host}:${stackPort}/ready`);
    });
}

async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    readyServer?.close();
    serverProcess.kill();
    appProcess.kill();
    process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    shutdown(1);
});