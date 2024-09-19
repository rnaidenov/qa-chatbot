import { composeConversationalContextChain } from './utils/compose-conversational-rag-chain';
import { StreamingTextResponse } from 'ai';
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { MatryoshkaRetriever } from "langchain/retrievers/matryoshka_retriever";
import { QdrantVectorStore } from "@langchain/qdrant";

const smallEmbeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-small",
  dimensions: 512,
});
const largeEmbeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-large",
  dimensions: 1536,
});

const handleResponse = async (sessionId: string, question: string): Promise<ReadableStream<string>> => {
  try {
    const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0, streaming: true  });

    const vectorStore = new QdrantVectorStore(smallEmbeddings, {
      url: process.env.QDRANT_URL,
      collectionName: "qa-chatbot",
    })

    const retriever = new MatryoshkaRetriever({
      vectorStore,
      largeEmbeddingModel: largeEmbeddings,
      largeK: 5,
    });

    const conversationalRAGChain = await composeConversationalContextChain({ sessionId, retriever, llm });

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

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
