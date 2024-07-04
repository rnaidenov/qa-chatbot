import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableSequence, RunnablePassthrough, RunnableWithMessageHistory, RunnableConfig } from "@langchain/core/runnables";
import { QA_CHAIN_TEMPLATE } from './consts';
// import { MultiQueryRetriever } from "langchain/retrievers/multi_query";
import { ComposeConversationalContextChainArgs } from './types';
import { convertDocsToWrappedString } from "./convert-docs-to-string";
import { contextualizedQuestion } from "./contextualized-question";
import { getMessageHistoryForSessionID } from "./get-message-history-for-session-id";
import { ChatOpenAI } from "@langchain/openai";

const createContextSummaryChain = (llm: any) => {
  const contextSummaryPrompt = ChatPromptTemplate.fromTemplate(`
  Based on the provided information, particularly the user's role, summarize the their ability to perform the requested action:

  User Info: {user_info}
  Context: {context}
  Current Question: {question}

  ONLY use information provided in the context. Do not invent or assume additional details.

  ## Output Format:

  Action: [Briefly describe the action the user is attempting]
  Current Status: [Describe the current state of the action, including if the user has completed any prerequisites]
  What is left: [Describe the remaining steps or prerequisites] 
  Action Permissions: [Who has the authority to perform the pending action(s)?]
  Next steps: [Briefly describe what the user should do / who they should contact next]

  Keep the summary concise and directly relevant to the user's current request.
  Do not mention the user's role explicitly in the output.
`);

  return RunnableSequence.from([contextSummaryPrompt, llm]);
};

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
      context_summary: async (input: Record<string, string>) => {
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

    // return finalResult.content;

    return new ReadableStream({
      async start(controller) {
        for await (const chunk of finalResult) {
          controller.enqueue(chunk.content);
        }
        controller.close();
      },
    });
  }
};