import { spawn } from 'child_process';
import { join } from 'path';
import { networkInterfaces } from 'os';
import fs from 'fs';

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
console.info('Starting ngrok (if available)');
const ngrok = spawn('ngrok', ['start', '--config', 'ngrok.yml', '--all'], {
    shell: true,
    stdio: 'ignore' // We'll get URLs via API
});

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

    const frontendUrl = await getNgrokUrl();
    if (frontendUrl) {
        console.info(`Public URL: ${frontendUrl || 'n/a'}`);
        fs.writeFileSync('.env.local', 'VITE_SERVER_URL=\n');
    } else {
        fs.writeFileSync('.env.local', 'VITE_SERVER_URL=\n');
    }

    console.info(`Frontend public: ${frontendUrl || 'n/a'} — local: http://localhost:5173`);
    console.info('Starting Vite dev server for client');
    const client = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0'], {
        cwd: process.cwd(),
        shell: true,
        stdio: 'inherit'
    });

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
