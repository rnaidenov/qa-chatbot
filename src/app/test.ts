import { PineconeStore } from "@langchain/pinecone";
import { ChatMessageHistory } from "langchain/memory";
import { composeConversationalContextChain } from "./api/query/utils/compose-conversational-rag-chain";
import { createRetrievalChain } from "./api/query/utils/create-retrieval-chain";
import { openAISetup } from "./api/query/utils/open-ai-setup";
import { PineconeIndex } from "./api/query/utils/pinecone-index";

const { model, embeddings } = openAISetup();

const messageHistories = {} as Record<string, ChatMessageHistory>;

const pineconeIndex = PineconeIndex.RagApp;

const getMessageHistoryForSession = (sessionId: string) => {
  if (messageHistories[sessionId] !== undefined) {
    return messageHistories[sessionId];
  }
  const newChatSessionHistory = new ChatMessageHistory();
  messageHistories[sessionId] = newChatSessionHistory;
  return newChatSessionHistory;
}

const main = async () => {
  const vectorStore = await PineconeStore.fromExistingIndex(
    embeddings,
    { pineconeIndex }
  );

  const retriever = vectorStore.asRetriever();
  const retrievalChain = await createRetrievalChain(retriever);

  const newChatSessionHistory = new ChatMessageHistory();

  const conversationalRAGChain = await composeConversationalContextChain('', newChatSessionHistory, retrievalChain, retriever);
}

main();