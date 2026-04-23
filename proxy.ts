import express, { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { getContainerIp } from './resolver.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Extend Request type to include our custom properties
interface ProxyRequest extends Request {
    proxyTarget?: string;
    proxyPrefix?: string;
}

// 1️⃣ THE DYNAMIC PROXY CONFIGURATION
const dynamicProxy = createProxyMiddleware({
    target: 'http://localhost', 
    changeOrigin: true,
    ws: true,
    router: (req: ProxyRequest) => req.proxyTarget || 'http://localhost',
    pathRewrite: (path: string, req: ProxyRequest) => {
        const rewritten = path.replace(req.proxyPrefix || '', '') || '/';
        return rewritten;
    },
    selfHandleResponse: true, 
    on: {
        proxyReq: (proxyReq, req: Request) => {
            proxyReq.setHeader('x-forwarded-host', req.headers.host || '');
            proxyReq.setHeader('x-forwarded-proto', 'http');
        },
        proxyRes: (proxyRes, req: ProxyRequest, res: Response) => {
            const contentType = proxyRes.headers['content-type'] || '';
            if (contentType.includes('text/html')) {
                let body = '';
                proxyRes.on('data', (chunk: Buffer) => body += chunk.toString());
                proxyRes.on('end', () => {
                    // Inject base tag so the browser knows where assets live
                    const baseTag = `<base href="${req.proxyPrefix}/">`;
                    body = body.replace('<head>', `<head>${baseTag}`);
                    res.writeHead(proxyRes.statusCode || 200, {
                        ...proxyRes.headers,
                        'content-length': Buffer.byteLength(body),
                        'content-security-policy': "" // Prevent CSP from blocking assets
                    });
                    res.end(body);
                });
            } else {
                res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                proxyRes.pipe(res);
            }
        },
        error: (_err: Error, _req: Request, res: Response | any) => {
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
                res.writeHead(502);
                res.end("Bad Gateway");
            }
        }
    },
    logger: console,
});

// 2️⃣ THE RESOLUTION MIDDLEWARE (Must be first!)
app.use(async (req: ProxyRequest, res: Response, next: NextFunction) => {
    let workspaceId = "";
    let port = "";

    // A. Try to get from URL params (e.g. /workspace123/5173/...)
    const pathParts = req.url?.split('/').filter(Boolean) || [];
    if (pathParts.length >= 2 && pathParts[0].length > 15) { // Assuming IDs are long strings
        workspaceId = pathParts[0];
        port = pathParts[1];
    } 
    // B. Fallback to Referer (for assets like /src/main.ts)
    else if (req.headers.referer) {
        const refUrl = new URL(req.headers.referer);
        const refParts = refUrl.pathname.split('/').filter(Boolean);
        if (refParts.length >= 2) {
            workspaceId = refParts[0];
            port = refParts[1];
        }
    }

    if (!workspaceId || workspaceId === '@vite' || workspaceId === 'src') {
        return next();
    }

    try {
        const containerIp = await getContainerIp(workspaceId);
        if (containerIp) {
            req.proxyTarget = `http://${containerIp}:${port}`;
            req.proxyPrefix = `/${workspaceId}/${port}`;
            return dynamicProxy(req, res, next);
        }
    } catch (e) {
        console.error("Resolution failed", e);
    }
    next();
});

// 3️⃣ CATCH-ALL FOR STATIC ASSETS THAT MATCH THE PATTERN
app.use('/:workspaceId/:port', dynamicProxy);

const server = app.listen(PORT, () => {
    console.log(`🚀 Proxy server running on port ${PORT}`);
});

// 4️⃣ WEBSOCKETS (HMR)
server.on('upgrade', async (req: ProxyRequest, socket, head) => {
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
});
