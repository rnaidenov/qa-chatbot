import { RunnableLike } from "@langchain/core/runnables";

export interface SplitOpts {
  chunkSize: number,
  chunkOverlap: number
}

export interface ComposeConversationalContextChainArgs {
  sessionId: string;
  retriever: RunnableLike;
  llm: RunnableLike;
}
