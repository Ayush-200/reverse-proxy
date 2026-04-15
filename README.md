# Reverse Proxy for Cloud IDE

## Overview
This reverse proxy routes incoming requests to the correct Fargate container based on workspace ID. It uses Redis to look up container IP addresses.

## Architecture

```
User Request → Reverse Proxy → Redis Lookup → Fargate Container
                    ↓
        /workspaceId/port/path
                    ↓
            Get IP from Redis
                    ↓
        Forward to http://IP:port/path
```

## How It Works

### 1. Request Flow
```
1. User accesses: http://proxy.com/workspace123/8080/api/files
2. Proxy extracts workspaceId: "workspace123" and port: "8080"
3. Proxy queries Redis: workspace:workspace123
4. Redis returns: { ip: "10.0.1.98", ... }
5. Proxy forwards to: http://10.0.1.98:8080/api/files
```

### 2. WebSocket Support
The proxy also handles WebSocket upgrades for terminal and file watching:
```
1. Client connects to: ws://proxy.com/workspace123/8080
2. Proxy extracts workspaceId and port from path
3. Proxy looks up container IP in Redis
4. Proxy upgrades connection to: ws://10.0.1.98:8080
```

## Configuration

### Environment Variables

Create a `.env` file:

```bash
# Reverse Proxy Configuration
PORT=3001

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Installation

```bash
cd reverse-proxy
npm install
```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
# Build
npm run build

# Start
npm start
```

## Redis Data Structure

The proxy expects workspace data in Redis with this format:

```
Key: workspace:{sessionId}

Value: {
  "ip": "10.0.1.98",
  "userId": "user-uuid",
  "projectName": "my-project",
  "sessionId": "session-id",
  "taskArn": "arn:aws:ecs:..."
}
```

## URL Routing Strategy

### Path-based Routing (Current Implementation)
```
http://proxy.com/workspaceId/port/path
```

**Examples:**
```
http://proxy.com/workspace123/8080/api/files
http://proxy.com/workspace123/8080/health
ws://proxy.com/workspace123/8080
```

**Extraction:**
```typescript
const pathParts = req.path.split('/').filter(Boolean);
const workspaceId = pathParts[0]; // "workspace123"
const port = pathParts[1]; // "8080"
const remainingPath = pathParts.slice(2).join('/'); // "api/files"
```

## Error Handling

### No Host Header
```
Status: 400
Response: { error: 'Host header is required' }
```

### Workspace Not Found in Redis
```
Status: 500
Response: { 
  error: 'Failed to proxy request',
  message: 'Workspace ID xxx is not valid. Unable to find the data in Redis'
}
```

### Container Unreachable
```
Status: 502
Response: "Bad gateway"
```

## Logging

The proxy logs all operations:

```
✅ Redis connected successfully
📡 Proxying request for workspace: workspace123
✅ Retrieved container IP for workspace workspace123: 10.0.1.98
🎯 Forwarding to: http://10.0.1.98:8080
🔌 WebSocket upgrade for workspace: workspace123
❌ Proxy error: ...
```

## Integration with Backend

The backend (`vercel-backend3`) stores workspace data in Redis when starting a container:

```typescript
// In session controller after task starts
await storeWorkspaceInRedis(sessionId, {
  ip: privateIp,
  userId,
  projectName,
  sessionId,
  taskArn
});
```

The reverse proxy reads this data to route requests.

## Testing

### Test HTTP Request
```bash
# Assuming workspace123 exists in Redis with IP 10.0.1.98
curl http://localhost:3001/workspace123/8080/health

# With path
curl http://localhost:3001/workspace123/8080/api/files
```

### Test WebSocket
```javascript
const ws = new WebSocket('ws://localhost:3001/workspace123/8080');
ws.on('open', () => console.log('Connected'));
```

### Test Redis Lookup
```bash
# Check if workspace exists
redis-cli
> GET workspace:workspace123
```

## Production Deployment

### 1. Deploy to EC2/ECS
```bash
# Build
npm run build

# Run with PM2
pm2 start dist/proxy.js --name reverse-proxy
```

### 2. Configure DNS
Point your domain to the reverse proxy server:
```
*.proxy.yourdomain.com → Reverse Proxy IP
```

### 3. Add SSL/TLS
Use nginx or AWS ALB in front of the reverse proxy for HTTPS:
```
User → HTTPS → ALB/Nginx → HTTP → Reverse Proxy → Container
```

### 4. Scale Horizontally
Run multiple instances behind a load balancer:
```
ALB → Reverse Proxy Instance 1
    → Reverse Proxy Instance 2
    → Reverse Proxy Instance 3
```

All instances share the same Redis for consistency.

## Security Considerations

### 1. Validate Workspace IDs
Add validation to prevent injection attacks:
```typescript
if (!/^[a-zA-Z0-9_-]+$/.test(workspaceId)) {
  return res.status(400).json({ error: 'Invalid workspace ID' });
}
```

### 2. Rate Limiting
Add rate limiting per workspace:
```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use(limiter);
```

### 3. Authentication
Verify user has access to the workspace:
```typescript
// Check if user owns this workspace
const userId = req.headers['x-user-id'];
const workspace = await getWorkspaceFromRedis(workspaceId);
if (workspace.userId !== userId) {
  return res.status(403).json({ error: 'Forbidden' });
}
```

## Monitoring

### Metrics to Track
- Request count per workspace
- Response times
- Error rates
- Redis connection status
- Active WebSocket connections

### Health Check Endpoint
Add a health check:
```typescript
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    redis: redis.status === 'ready' ? 'connected' : 'disconnected'
  });
});
```

## Troubleshooting

### "Redis connection error"
- Check Redis is running: `redis-cli ping`
- Verify REDIS_HOST and REDIS_PORT in .env
- Check network connectivity

### "Workspace ID is not valid"
- Verify workspace exists in Redis: `redis-cli GET workspace:xxx`
- Check backend is storing workspaces correctly
- Verify sessionId matches

### "502 Bad Gateway"
- Container might be stopped or unhealthy
- Check container IP is correct
- Verify security groups allow traffic
- Check container is listening on port 8080

## Future Enhancements

1. **Caching**: Cache Redis lookups for better performance
2. **Load Balancing**: Support multiple containers per workspace
3. **Sticky Sessions**: Route same user to same container
4. **Metrics**: Add Prometheus metrics
5. **Logging**: Structured logging with Winston
6. **Circuit Breaker**: Fail fast when containers are down
7. **Request Timeout**: Add configurable timeouts
8. **Compression**: Enable gzip compression
9. **CORS**: Add CORS support for cross-origin requests
10. **Health Checks**: Periodic health checks to containers

## License

MIT
