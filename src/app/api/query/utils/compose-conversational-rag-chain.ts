import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableSequence, RunnablePassthrough, RunnableWithMessageHistory, RunnableConfig } from "@langchain/core/runnables";
import { QA_CHAIN_TEMPLATE } from './consts';
import { ComposeConversationalContextChainArgs } from './types';
import { convertDocsToWrappedString } from "./convert-docs-to-string";
import { contextualizedQuestion } from "./contextualized-question";
import { getMessageHistoryForSessionID } from "./get-message-history-for-session-id";
import { ChatOpenAI } from "@langchain/openai";

const createContextSummaryChain = (llm) => {
  const contextSummaryPrompt = ChatPromptTemplate.fromTemplate(`
  Based on the following information, provide a brief internal summary of the user's context:

  ONLY adhere to information provided in the context.

  User Info: {user_info}
  Context: {context}
  Current Question: {question}

  Summarize the user's main ask and whether they, given their role, can carry out the task themselves or will need support from <X> member of the team. 
`);

  return RunnableSequence.from([
    contextSummaryPrompt,
    llm,
  ]);
};

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
          const chain = contextualizedQuestion(input, { llm }) as RunnableSequence;
          const docs = await chain.pipe(retriever).invoke(input);

          return convertDocsToWrappedString(docs);
        }
        return "";
      },
      user_info: (input: Record<string, unknown>) => "The user is an external developer",
    }),
    RunnablePassthrough.assign({
      context_summary: async (input: Record<string, string>) => {
        const summary = await contextSummaryChain.invoke({
          user_info: input.user_info,
          context: input.context,
          question: input.question
        });
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

    const finalResult = await chainWithHistory.stream(
      { question: followUpQuestion },
      config
    );

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