import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableSequence, RunnablePassthrough, RunnableWithMessageHistory, RunnableConfig } from "@langchain/core/runnables";
import { QA_CHAIN_TEMPLATE } from './consts';
import { MultiQueryRetriever } from "langchain/retrievers/multi_query";
import { ComposeConversationalContextChainArgs } from './types';
import { convertDocsToWrappedString } from "./convert-docs-to-string";
import { contextualizedQuestion } from "./contextualized-question";
import { getMessageHistoryForSessionID } from "./get-message-history-for-session-id";
import { ChatOpenAI } from "@langchain/openai";

const createContextSummaryChain = (llm: any) => {
  const contextSummaryPrompt = ChatPromptTemplate.fromTemplate(`
  Based on the provided information, summarize the user's ability to perform the requested action:

  User role: {user_info}
  Context: {context}
  Current Question: {question}

  ONLY use information provided in the context. Do not invent or assume additional details.
  
  ## Output format (only this):
  [Concisely summarize the user's ability to perform the action, noting any blockers or need for external assistance]
  
  > Processing steps:
  Action: Think through the action the user is attempting
  Current Status: What is current state of the action? What has been done so far?
  Remaining Steps: What are the steps left to complete the action? Which ones can the user perform and which require assistance?
  Key Contacts: If applicable, consider what specific teams or roles (e.g. Publishing Manager) should the user contact for assistance. HomaLab is a platform, shouldn't include here.
  
  > Guidelines:
  Keep the summary concise and directly relevant to the user's current request.
  Do not explicitly state the user's role in the output.
  Focus on identifying any actions that the user may not be able to perform and should delegate to others.

`);

  return RunnableSequence.from([contextSummaryPrompt, llm]);
};


// gpt3.5

// const gpt3_5 = new ChatOpenAI({ model: "gpt-3.5-turbo", temperature: 0 });

// TODO: Cool, but not really needed. FOR NOW.
// const generateQueries = async (question: string, llm: any, retriever: any) => {
//   const retrieve = (question: string) => MultiQueryRetriever.fromLLM({
//     llm,
//     retriever: retriever,
//     prompt: ChatPromptTemplate.fromMessages(
//       ['system', `Given the following question, please generate 2-3 subqueries that would help in answering the main question. Focus on key concepts and actions mentioned.

//       Original question: {question}

//       Subqueries:
//       1.
//       2.
//       3. (optional)
//       `],
//     ),
//   }).invoke(question);

//   return await retrieve(question);
// };

export const composeConversationalContextChain = async ({
  sessionId,
  retriever,
  llm
}: ComposeConversationalContextChainArgs) => {
  const answerGenerationPrompt = ChatPromptTemplate.fromMessages([
    ["system", QA_CHAIN_TEMPLATE],
    new MessagesPlaceholder("history"),
    [
      "human",
      "{question}"
    ]
  ]);

  const contextSummaryChain = createContextSummaryChain(llm);

  const answerChain = RunnableSequence.from([
    RunnablePassthrough.assign({
      context: async (input: Record<string, unknown>) => {
        if ("history" in input) {
          const chain = contextualizedQuestion(input, { llm }) as RunnableSequence
          const docs = await chain.pipe(retriever).invoke(input)

          return convertDocsToWrappedString(docs);
        }
        return "";
      },
    }),
    RunnablePassthrough.assign({
      user_rights: async (input: Record<string, string>) => {
        const summary = await contextSummaryChain.invoke({
          user_info: "The user is an external developer",
          context: input.context,
          question: input.question
        });
        console.log("🚀 ~ context_summary: ~ summary.content:", summary.content)
        return summary.content;
      }
    }),
    answerGenerationPrompt,
    llm
  ]);

  const messageHistory = getMessageHistoryForSessionID(sessionId);

  const chainWithHistory = new RunnableWithMessageHistory({
    runnable: answerChain,
    getMessageHistory: (_sessionId: string) => messageHistory,
    inputMessagesKey: "question",
    historyMessagesKey: "history",
  });

  return async (followUpQuestion: string) => {
    const config: RunnableConfig = { configurable: { sessionId } }

    const finalResult = await chainWithHistory.invoke(
      { question: followUpQuestion },
      config
    );

    return finalResult.content;

    // return new ReadableStream({
    //   async start(controller) {
    //     for await (const chunk of finalResult) {
    //       controller.enqueue(chunk.content);
    //     }
    //     controller.close();
    //   },
    // });
  }
};