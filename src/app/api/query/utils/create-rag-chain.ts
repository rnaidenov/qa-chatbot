import { PineconeStore } from "@langchain/pinecone";
import { Document } from "langchain/document";
import { ChatPromptTemplate } from "langchain/prompts";
import { RunnableSequence } from "langchain/runnables";
import { StringOutputParser } from "langchain/schema/output_parser";
import { formatDocumentsAsString } from "langchain/util/document";
import { VectorStoreRetriever } from "langchain/vectorstores/base";
import { convertDocsToWrappedString } from "./convert-docs-to-string";

const TEMPLATE_STRING = `You are an experienced researcher, 
expert at interpreting and answering questions based on provided sources.
Using the provided context, answer the user's question 
to the best of your ability using only the resources provided. 
Be verbose!

<context>

{context}

</context>

Now, answer this question using the above context:

{question}`;

// const runnableMap = RunnableMap.from({
//   context: documentRetrievalChain,
//   question: (input) => input.question,
// });
// const res = await runnableMap.invoke({
//   question: "What would be the impact of outdated info for user manual documentation?"
// })
// console.log("🚀 ~ res:", res)

const answerGenerationPrompt = ChatPromptTemplate.fromTemplate(
  TEMPLATE_STRING
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