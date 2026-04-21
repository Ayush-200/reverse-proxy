import express from 'express';
import httpProxy from 'http-proxy'; 
import { getContainerIp } from './resolver.js';
import { IncomingMessage, ServerResponse } from 'node:http';
const app = express();
const PORT = process.env.PORT;

const proxy = httpProxy.createProxyServer({});

proxy.on("error", ((err: Error, req: IncomingMessage, res: ServerResponse) => {
    console.error("error occurred in proxy", err.message);

    if (res && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad gateway");
    }
  }) as any
);

app.use(async (req, res) => {
  try {
    const url = req.url || "/";
    const parts = url.split('/').filter(Boolean);

    const workspaceId = parts[0];
    const port = parts[1];

    if (!workspaceId || !port) {
      return res.status(404).json({ message: "workspace id or port not found" });
    }

    const containerIp = await getContainerIp(workspaceId);
    if (!containerIp) {
      return res.status(404).send("Workspace not found");
    }

    const target = `http://${containerIp}:${port}`;

    // ✅ safer rewrite
    req.url = url.replace(`/${workspaceId}/${port}`, '') || '/';
    if (!req.url.startsWith('/')) req.url = '/' + req.url;

    proxy.web(req, res, {
      target,
      changeOrigin: true,
      ws: true
    });

  } catch (error) {
    res.status(500).json({ message: "error occured in app in reverse proxy" });
  }
});

const server = app.listen(PORT, ()=> {
    console.log(`proxy server is running on port ${PORT}`);
})

server.on("upgrade", async (req, socket, head) => {
    try{
        const url = req.url || "/";
       
        if(!url){
            console.error("invalid url");
            return;
        }

        const parts = url?.split('/').filter(Boolean);
        const workspaceId = parts[0];
        const port = parts[1];

        if (!workspaceId || !port) {
            socket.destroy();
            return;
        }

        const containerIp = await getContainerIp(workspaceId);
        if(!containerIp){
            socket.destroy();
            return;
        }
        req.url = url.replace(`/${workspaceId}/${port}`, '') || '/';

        proxy.ws(req, socket, head, {
            target: `http://${containerIp}:${port}`
        });

        
    }catch(err){
        socket.destroy();
    }
})