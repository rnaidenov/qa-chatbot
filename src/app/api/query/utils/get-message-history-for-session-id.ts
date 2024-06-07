import { ChatMessageHistory } from "langchain/memory";

// TODO: Implement this using Redis
const messageHistories = {} as Record<string, ChatMessageHistory>;

export const getMessageHistoryForSessionID = (sessionId: string) => {
  if (messageHistories[sessionId] !== undefined) {
    return messageHistories[sessionId];
  }
  const newChatSessionHistory = new ChatMessageHistory();
  messageHistories[sessionId] = newChatSessionHistory;
  return newChatSessionHistory;
}