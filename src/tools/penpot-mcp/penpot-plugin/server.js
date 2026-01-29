#!/usr/bin/env node
/**
 * Simple static file server for Penpot MCP Plugin
 * Serves the plugin files on port 4400
 */

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PENPOT_MCP_PLUGIN_PORT || 4400;
const DIST_DIR = join(__dirname, 'dist');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
    // Enable CORS for Penpot
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Parse URL and strip query parameters
    const urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;
    let filePath = urlPath === '/' ? '/index.html' : urlPath;
    filePath = join(DIST_DIR, filePath);

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
        const content = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    } catch (err) {
        if (err.code === 'ENOENT') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
        } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('500 Internal Server Error');
        }
    }
});

server.listen(PORT, () => {
    console.log(`[Penpot Plugin Server] Running at http://localhost:${PORT}/`);
    console.log(`[Penpot Plugin Server] Manifest: http://localhost:${PORT}/manifest.json`);
});

process.on('SIGTERM', () => {
    console.log('[Penpot Plugin Server] Shutting down...');
    server.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[Penpot Plugin Server] Shutting down...');
    server.close();
    process.exit(0);
});
