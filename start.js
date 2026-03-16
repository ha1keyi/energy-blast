import { spawn } from 'child_process';
import { join } from 'path';
import { networkInterfaces } from 'os';
import fs from 'fs';
import net from 'net';

// 获取本机IP地址
function getLocalIP() {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const localIP = getLocalIP();

console.info('Starting Energy Blast (start script)');

// --- Step 1: Start Server ---
console.info('Starting server and dev tools');
const server = spawn('npm', ['start'], {
    cwd: join(process.cwd(), 'server'),
    shell: true,
    stdio: 'inherit',
    env: {
        ...process.env,
        HOST: '0.0.0.0',
        PORT: '3000'
    }
});

// --- Step 2: Start ngrok ---
// We'll start ngrok after the client so the tunnel maps the actual client port.
let ngrok;

// --- Step 3: Wait for ngrok URLs and start Client ---
// async function getNgrokUrls(retries = 10) {
//     for (let i = 0; i < retries; i++) {
//         try {
//             const response = await fetch('http://localhost:4040/api/tunnels');
//             const data = await response.json();
//             const tunnels = data.tunnels;
//             if (tunnels && tunnels.length >= 2) {
//                 const frontend = tunnels.find(t => t.name === 'frontend' && t.proto === 'https')?.public_url;
//                 const backend = tunnels.find(t => t.name === 'backend' && t.proto === 'https')?.public_url;
//                 if (frontend && backend) return { frontend, backend };
//             }
//         } catch (e) {
//             // ngrok might not be ready yet
//         }
//         await new Promise(r => setTimeout(r, 1000));
//     }
//     return null;

async function getNgrokUrl(retries = 10) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch('http://localhost:4040/api/tunnels');
            const data = await response.json();
            const frontend = data.tunnels?.find(t => t.proto === 'https');
            if (frontend) return frontend.public_url;
        } catch (e) { }
        await new Promise(r => setTimeout(r, 1000));
    }
    return null;
}

function isPortFree(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        socket.setTimeout(250);

        socket.once('connect', () => {
            settled = true;
            socket.destroy();
            resolve(false); // something is listening -> not free
        });

        socket.once('timeout', () => {
            if (!settled) {
                settled = true;
                socket.destroy();
                resolve(true);
            }
        });

        socket.once('error', () => {
            if (!settled) {
                settled = true;
                socket.destroy();
                resolve(true); // connection refused -> port free
            }
        });

        socket.connect(port, host);
    });
}

async function findAvailablePort(startPort, maxAttempts = 200) {
    let port = Number(startPort) || 5173;
    for (let i = 0; i < maxAttempts; i++) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await isPortFree(port);
        if (ok) return port;
        port += 1;
    }
    return null;
}

(async () => {
    // const urls = await getNgrokUrls();

    // if (urls) {
    //     console.log('✅ ngrok Tunnels established:');
    //     console.log(`🌍 Frontend (Public): ${urls.frontend}`);
    //     // console.log(`🔗 Backend (Public): ${urls.backend}`);
    //     console.log('');

    //     // Write .env.local for Vite to pick up the public backend URL
    //     fs.writeFileSync('.env.local', `VITE_SERVER_URL=${urls.backend}\n`);
    //     console.log('📝 Updated .env.local with public backend URL.');
    // } else {
    //     console.warn('⚠️  Could not retrieve ngrok URLs. Using local fallback.');
    //     fs.writeFileSync('.env.local', `VITE_SERVER_URL=http://${localIP}:3000\n`);
    // }

    const requestedPort = process.env.CLIENT_PORT || process.argv[2] || '5173';
    const clientPort = (await findAvailablePort(requestedPort)) || Number(requestedPort) || 5173;

    console.info(`Local: http://localhost:${clientPort}`);
    console.info('Starting Vite dev server for client');
    const client = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(clientPort)], {
        cwd: process.cwd(),
        shell: true,
        stdio: 'inherit'
    });

    // Start ngrok and point it at the client port so public URL maps correctly
    try {
        console.info('Starting ngrok (if available) for frontend tunnel');
        ngrok = spawn('ngrok', ['http', String(clientPort)], {
            shell: true,
            stdio: 'ignore'
        });
    } catch (e) {
        console.warn('ngrok not available or failed to start:', e.message || e);
        ngrok = null;
    }

    const frontendUrl = await getNgrokUrl();
    if (frontendUrl) {
        console.info(`Public URL: ${frontendUrl}`);
        fs.writeFileSync('.env.local', 'VITE_SERVER_URL=\n');
    } else {
        fs.writeFileSync('.env.local', 'VITE_SERVER_URL=\n');
    }

    console.info(`Frontend public: ${frontendUrl || 'n/a'} — local: http://localhost:${clientPort}`);

    const cleanup = () => {
        console.info('Stopping child processes...');
        server.kill();
        client.kill();
        ngrok.kill();
        process.exit();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
})();
