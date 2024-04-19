import { PineconeStore } from "@langchain/pinecone";
import { PineconeIndex } from "./utils/pinecone-index";
import { openAISetup } from "./utils/open-ai-setup";
import { createRAGChain } from "./utils/create-rag-chain";
import { composeConversationalContextChain } from './utils/compose-conversational-rag-chain';
import { ChatMessageHistory } from 'langchain/memory';
import { StreamingTextResponse } from 'ai';

const { model, embeddings } = openAISetup();

const pineconeIndex = PineconeIndex.RagApp;

const messageHistories = {} as Record<string, ChatMessageHistory>;

const getMessageHistoryForSession = (sessionId: string) => {
  if (messageHistories[sessionId] !== undefined) {
    return messageHistories[sessionId];
  }
  const newChatSessionHistory = new ChatMessageHistory();
  messageHistories[sessionId] = newChatSessionHistory;
  return newChatSessionHistory;
}

const handleResponse = async (sessionId: string, question: string): Promise<ReadableStream<string>> => {
  try {
    const vectorStore = await PineconeStore.fromExistingIndex(
      embeddings,
      { pineconeIndex }
    );

    const retriever = vectorStore.asRetriever();
    const retrievalChain = await createRAGChain(model, retriever);

    const messageHistory = getMessageHistoryForSession(sessionId);
    const conversationalRAGChain = await composeConversationalContextChain(
      sessionId, messageHistory, retrievalChain
    );

    return conversationalRAGChain(question);
  } catch (error) {
    console.error('Error during handleResponse:', error);
    throw error;
  }
}

export async function POST(req: Request) {
  try {
    const { sessionId, question } = await req.json()
    const answer = await handleResponse(sessionId, question);

    return new StreamingTextResponse(answer)
  } catch (error) {
    console.error('Error in POST /api/query:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

export const runtime = 'edge';