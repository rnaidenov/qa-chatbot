import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableSequence, RunnablePassthrough, RunnableWithMessageHistory, RunnableConfig } from "@langchain/core/runnables";
import { QA_CHAIN_TEMPLATE } from './consts';
import { ComposeConversationalContextChainArgs } from './types';
import { convertDocsToWrappedString } from "./convert-docs-to-string";
import { contextualizedQuestion } from "./contextualized-question";
import { getMessageHistoryForSessionID } from "./get-message-history-for-session-id";

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


  const answerChain = RunnableSequence.from([
    RunnablePassthrough.assign({
      context: (input: Record<string, unknown>) => {
        if ("history" in input) {
          const chain = contextualizedQuestion(input, { llm }) as RunnableSequence;
          return chain.pipe(retriever).pipe(convertDocsToWrappedString);
        }
        return "";
      },
    }),
    answerGenerationPrompt,
    llm,
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