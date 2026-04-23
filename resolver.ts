import redis from './redis';

export async function getContainerIp(workspaceId: string): Promise<string | null> {
    try {
        const data = await redis.get(`workspace:${workspaceId}`); 
        if(!data){
            console.error(`❌ Workspace ID ${workspaceId} not found in Redis`);
            return null;
        }
        
        const parsedData = JSON.parse(data);
        const containerIp = parsedData.ip;

        if(!containerIp){
            console.error(`❌ No IP found for workspace ${workspaceId}`);
            return null;
        }
        
        console.log(`✅ Retrieved container IP for workspace ${workspaceId}: ${containerIp}`);
        return containerIp;
    } catch (error) {
        console.error(`❌ Error retrieving workspace ${workspaceId}:`, error);
        return null;
    }
}
