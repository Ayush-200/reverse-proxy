import redis from './redis';

export async function getContainerIp(workspaceId: string) {
    const data = await redis.get(`workspace:${workspaceId}`); 
    if(!data){
        throw new Error(`Workspace ID ${workspaceId} is not valid. Unable to find the data in Redis`);
    }
    
    const parsedData = JSON.parse(data);
    const containerIp = parsedData.ip; // Changed from containerIp to ip

    if(!containerIp){
        throw new Error(`Unable to find container IP in Redis for workspace ${workspaceId}`);
    }
    
    console.log(`✅ Retrieved container IP for workspace ${workspaceId}: ${containerIp}`);
    return containerIp;
}
