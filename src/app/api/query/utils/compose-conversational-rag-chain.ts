import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { RunnableSequence, RunnablePassthrough, RunnableWithMessageHistory, RunnableConfig } from '@langchain/core/runnables';
import { RunnableLike } from "@langchain/core/runnables";
import { QA_CHAIN_TEMPLATE, RELEVANCY_CHECK_TEMPLATE } from './consts';
import { Document } from "langchain/document";
import { ComposeConversationalContextChainArgs } from './types';
import { convertDocsToWrappedString } from './transform-and-wrap-documents';
import { contextualizedQuestion } from './contextualized-question';
import { getMessageHistoryForSessionId } from './get-message-history-for-session-id';
import { sessionIdToUserRole } from './session-id-to-user-role';
import { relevancyCheckParser } from './parsers/relevancy-check-parser';
import { updateInternalProcessing } from './for-later';

const createRelevancyCheckChain = (llm: RunnableLike) => {
  const promptTemplate = ChatPromptTemplate.fromTemplate(RELEVANCY_CHECK_TEMPLATE);

  return RunnableSequence.from([
    {
      context: (input) => input.context,
      user_info: (input) => input.user_info,
      question: (input) => input.question,
      format_instructions: async () => relevancyCheckParser.getFormatInstructions(),
    },
    promptTemplate,
    llm,
    relevancyCheckParser,
  ]);
};

const createAnswerGenerationPrompt = () => {
  return ChatPromptTemplate.fromMessages([
    ["system", QA_CHAIN_TEMPLATE],
    new MessagesPlaceholder("history"),
    ["human", "{question}"]
  ]);
};

const createAnswerChain = (llm: RunnableLike, retriever: RunnableLike, userRole: string) => {
  const relevancyCheck = createRelevancyCheckChain(llm)
  const answerGenerationPrompt = createAnswerGenerationPrompt();

  return RunnableSequence.from([
    RunnablePassthrough.assign({
      context: async (input: Record<string, unknown>) => {
        if ("history" in input) {
          const chain = contextualizedQuestion(input, { llm }) as RunnableSequence;
          const docs = await chain.pipe(retriever).invoke(input) as Document[]

          return await convertDocsToWrappedString(docs);
        }
        return "";
      },
    }),
    RunnablePassthrough.assign({
      internal_processing: async (input: Record<string, any>) => {
        const summary = await relevancyCheck.invoke({
          ...input,
          user_info: "The asking user is " + userRole,
        });

        return updateInternalProcessing(summary);
      },
    }),
    answerGenerationPrompt,
    llm
  ]);
};

export const composeConversationalContextChain = async ({
  sessionId,
  retriever,
  llm
}: ComposeConversationalContextChainArgs) => {
  console.log("🚀 ~ sessionId:", sessionId)
  if (!sessionId || !retriever || !llm) {
    throw new Error("Missing required parameters for composeConversationalContextChain");
  }

  const answerChain = createAnswerChain(llm, retriever, sessionIdToUserRole(sessionId));

  const chainWithHistory = new RunnableWithMessageHistory({
    runnable: answerChain,
    // using redis-based message history
    // getMessageHistory: (sessionId) => upstashRedisChatHistory(sessionId),
    // using local message history
    getMessageHistory: (sessionId) => getMessageHistoryForSessionId(sessionId),
    inputMessagesKey: "question",
    historyMessagesKey: "history",
  });

  return async (followUpQuestion: string): Promise<ReadableStream<string>> => {
    if (!followUpQuestion.trim()) {
      throw new Error("Follow-up question cannot be empty");
    }

    const config: RunnableConfig = { configurable: { sessionId } };

    try {
      const finalResult = await chainWithHistory.stream(
        { question: followUpQuestion },
        config
      );

      return new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of finalResult) {
              controller.enqueue(chunk.content);
            }
          } catch (error) {
            console.error("Error processing stream:", error);
            controller.error(error);
          } finally {
            controller.close();
          }
        },
      });
    } catch (error) {
      console.error("Error in conversational context chain:", error);
      throw error;
    }
  };
};