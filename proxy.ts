import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { getContainerIp } from './resolver.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ The "Magic" Middleware: Identifies the target BEFORE the proxy runs
app.use('/:workspaceId/:port', async (req: any, res, next) => {
    try {
        const { workspaceId, port } = req.params;
        
        if (!workspaceId || !port) {
            return res.status(400).send("Missing workspace ID or port");
        }

        const containerIp = await getContainerIp(workspaceId);

        if (!containerIp) {
            return res.status(404).send("Workspace not found");
        }

        // Attach info to the req object so the proxy can see it
        req.proxyTarget = `http://${containerIp}:${port}`;
        req.proxyPrefix = `/${workspaceId}/${port}`;
        
        // Pass control to the proxy
        next();
    } catch (error) {
        console.error('Error in proxy middleware:', error);
        return res.status(500).send("Internal proxy error");
    }
});

const dynamicProxy = createProxyMiddleware({
    target: 'http://localhost', 
    changeOrigin: true,
    ws: true,
    router: (req: any) => {
        return req.proxyTarget || 'http://localhost';
    },
    pathRewrite: (path, req: any) => {
        const rewritten = path.replace(req.proxyPrefix || '', '') || '/';
        console.log(`Rewriting: ${path} -> ${rewritten}`);
        return rewritten;
    },
    selfHandleResponse: true, // We'll handle the response ourselves
    on: {
        proxyReq: (proxyReq, req) => {
            proxyReq.setHeader('x-forwarded-host', req.headers.host || '');
            proxyReq.setHeader('x-forwarded-proto', 'http');
        },
        proxyRes: (proxyRes, req: any, res) => {
            const contentType = proxyRes.headers['content-type'] || '';
            
            // Only modify HTML responses
            if (contentType.includes('text/html')) {
                let body = '';
                proxyRes.on('data', (chunk: Buffer) => {
                    body += chunk.toString();
                });
                proxyRes.on('end', () => {
                    // Inject base tag to fix relative paths
                    const baseTag = `<base href="${req.proxyPrefix}/">`;
                    body = body.replace('<head>', `<head>${baseTag}`);
                    
                    res.writeHead(proxyRes.statusCode || 200, {
                        ...proxyRes.headers,
                        'content-length': Buffer.byteLength(body)
                    });
                    res.end(body);
                });
            } else {
                // For non-HTML, just pipe through
                res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                proxyRes.pipe(res);
            }
        },
        error: (err, req, res: any) => {
            console.error("Proxy Error:", err.message);
            if (res && 'writeHead' in res && !res.headersSent) {
                res.writeHead(502, { "Content-Type": "text/plain" });
                res.end("Bad Gateway: Container unreachable");
            }
        }
    },
    logger: console,
});

// Apply the proxy after the middleware
app.use('/:workspaceId/:port', dynamicProxy);

const server = app.listen(PORT, () => {
    console.log(`🚀 Proxy server running on port ${PORT}`);
});

// ✅ WebSocket Fix: Must still parse URL because req.params isn't available here
server.on('upgrade', async (req: any, socket, head) => {
    try {
        const parts = req.url?.split('/').filter(Boolean) || [];
        const workspaceId = parts[0];
        const port = parts[1];

        if (workspaceId && port) {
            const containerIp = await getContainerIp(workspaceId);
            if (containerIp) {
                req.proxyTarget = `http://${containerIp}:${port}`;
                req.proxyPrefix = `/${workspaceId}/${port}`;
                // @ts-ignore
                return dynamicProxy.upgrade(req, socket, head);
            }
        }
        socket.destroy();
    } catch (error) {
        console.error('WebSocket upgrade error:', error);
        socket.destroy();
    }
});