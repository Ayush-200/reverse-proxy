import { getContainerIp } from "./resolver";
import * as http from "http";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import httpProxy from "http-proxy";

const proxy = httpProxy.createProxyServer({});



function parseHost(host: string) {
  // Remove port if present
  const cleanHost = host.split(":")[0];

  // Example:
  // 5173-kqFxCo6.13.232.37.129.nip.io
  const subdomain = cleanHost.split(".")[0];

  const [port, workspaceId] = subdomain.split("-");

  return {
    port,
    workspaceId,
  };
}

const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
  try {
    const host = req.headers.host;

    if (!host) {
      res.writeHead(400);
      return res.end("Missing Host header");
    }

    const { port, workspaceId } = parseHost(host);

    if (!port || !workspaceId) {
      res.writeHead(400);
      return res.end("Invalid subdomain format");
    }

    const targetIP = getContainerIp(workspaceId);

    if (!targetIP) {
      res.writeHead(404);
      return res.end("Workspace not found");
    }

    const target = `http://${targetIP}:${port}`;

    console.log(`Routing → ${host} → ${target}${req.url}`);

    proxy.web(req, res, {
      target,
      changeOrigin: true,
    });

  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end("Proxy error");
  }
});

server.listen(3001, "0.0.0.0", () => {
  console.log("Reverse proxy running on port 3001");
});

server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
  const host = req.headers.host;
  
  if (!host) {
    socket.destroy();
    return;
  }
  
  const { port, workspaceId } = parseHost(host);

  const targetIP = getContainerIp(workspaceId);
  const target = `ws://${targetIP}:${port}`;

  proxy.ws(req, socket, head, {
    target,
    changeOrigin: true,
  });
});