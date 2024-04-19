import { PineconeStore } from "@langchain/pinecone";
import { Document } from "langchain/document";
import { ChatPromptTemplate } from "langchain/prompts";
import { RunnableSequence } from "langchain/runnables";
import { StringOutputParser } from "langchain/schema/output_parser";
import { VectorStoreRetriever } from "langchain/vectorstores/base";
import { convertDocsToWrappedString } from "./convert-docs-to-string";
import { CONTEXT_CHAIN } from "../consts";


const answerGenerationPrompt = ChatPromptTemplate.fromTemplate(
  CONTEXT_CHAIN
);

export const createRAGChain = async (
  model: any,
  retriever: VectorStoreRetriever<PineconeStore>
) => {
  // A sequence of runnables, where the output of each is the input of the next.
  // => contextRetrievalChain will retrieve using input.query from pinecone and the output will be wrapped into a string
  const contextRetrievalChain = RunnableSequence.from([
    (input) => input.question,
    retriever,
    convertDocsToWrappedString
  ]);

  const retrievalChain = RunnableSequence.from([
    {
      context: contextRetrievalChain,
      question: (input: { question: string }) => input.question,
    },
    answerGenerationPrompt,
    model,
    new StringOutputParser(),
  ]);

  return retrievalChain;
}