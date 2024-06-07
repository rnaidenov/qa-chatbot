import { PineconeStore } from "@langchain/pinecone";
import { PineconeIndex } from "./utils/pinecone-index";
import { MultiQueryRetriever } from "langchain/retrievers/multi_query";
import { composeConversationalContextChain } from './utils/compose-conversational-rag-chain';
import { pull } from "langchain/hub";
import { StreamingTextResponse } from 'ai';
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";

const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-large",
  dimensions: 3072,
});
const pineconeIndex = PineconeIndex.RagApp;

const handleResponse = async (sessionId: string, question: string): Promise<ReadableStream<string>> => {
  try {
    const vectorStore = await PineconeStore.fromExistingIndex(
      embeddings,
      { pineconeIndex }
    );

    const multiQueryPrompt = await pull('jacob/multi-query-retriever') as PromptTemplate;

    const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });

    const retriever = MultiQueryRetriever.fromLLM({
      llm,
      verbose: true,
      prompt: multiQueryPrompt,
      retriever: vectorStore.asRetriever(),
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
