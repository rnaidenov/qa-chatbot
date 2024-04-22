import { PineconeStore } from "@langchain/pinecone";
import { Document } from "langchain/document";
import { ChatPromptTemplate } from "langchain/prompts";
import { RunnableSequence } from "langchain/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { VectorStoreRetriever } from "langchain/vectorstores/base";
import { convertDocsToWrappedString } from "./convert-docs-to-string";
import { QA_CHAIN_TEMPLATE } from "../consts";


// const answerGenerationPrompt = ChatPromptTemplate.fromTemplate(
//   QA_CHAIN_TEMPLATE
// );

export const createRetrievalChain = async (
  retriever: VectorStoreRetriever<PineconeStore>
) => {
  // A sequence of runnables, where the output of each is the input of the next.
  // => contextRetrievalChain will retrieve using input.query from pinecone and the output will be wrapped into a string
  const retrievalChain = RunnableSequence.from([
    (input) => input.question,
    retriever,
    convertDocsToWrappedString
  ]);

  // const retrievalChain = RunnableSequence.from([
  //   // Objects are automatically converted to a RunnableMap in this RunnableSequence.from initializer
  //   {
  //     context: contextRetrievalChain,
  //     question: (input: { question: string }) => input.question,
  //   },
  //   // we pass the above to the below prompt
  //   answerGenerationPrompt,
  //   // pass that to the model
  //   model,
  //   // and finally, we parse the output as a string
  //   new StringOutputParser(),
  // ]);

  return retrievalChain;
}