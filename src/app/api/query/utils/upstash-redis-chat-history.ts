import { UpstashRedisChatMessageHistory } from "@langchain/community/stores/message/upstash_redis";

export const upstashRedisChatHistory = (sessionId: string) => {
  return new UpstashRedisChatMessageHistory({
    sessionId,
    config: {
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    },
  });
}