import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { RunnableSequence, RunnablePassthrough, RunnableWithMessageHistory, RunnableConfig } from '@langchain/core/runnables';
import { RunnableLike } from "@langchain/core/runnables";
import { UpstashRedisChatMessageHistory } from "@langchain/community/stores/message/upstash_redis";
import { QA_CHAIN_TEMPLATE } from './consts';
import { Document } from "langchain/document";
import { ComposeConversationalContextChainArgs } from './types';
import { convertDocsToWrappedString } from './convert-docs-to-string';
import { contextualizedQuestion } from './contextualized-question';
import { getMessageHistoryForSessionId } from './get-message-history-for-session-id';
// import { upstashRedisChatHistory } from './upstash-redis-chat-history';
import { sessionIdToUserRole } from './session-id-to-user-role';

const createContextSummaryChain = (llm: RunnableLike) => {
  const contextSummaryPrompt = ChatPromptTemplate.fromTemplate(`
  Based on the provided information, summarize the user's ability to perform the requested action. 
  If the question is not related to Homa Games' products, services (incl. SDK), or internal processes, please state the question is out of scope.

  User role: {user_info}
  Context: {context}
  Current Question: {question}

  DO NOT ASSUME ANYTHING NOT EXPLICITLY STATED IN THE CONTEXT. EVERYTHING MUST BE DERIVED FROM THE PROVIDED INFORMATION.
  IF NO EXPLICIT MENTION OF USER PERMISSIONS, ASSUME THEY CAN DO IT.
  IF EXPLICIT MENTION OF EXTERNAL PERMISSIONS (e.g. only Publishing Manager can carry out check), STATE THAT THE USER CANNOT DO IT.

  Output example: 
  The user [can / cannot] fully perform the requested action [if cannot: because [reasoning (e.g. only Publishing Manager can carry out check)]].
  The question is [relevant / not relevant] to Homa Games' products, services (incl. SDK), or internal processes.
`);

  return RunnableSequence.from([contextSummaryPrompt, llm]);
};

const createAnswerGenerationPrompt = () => {
  return ChatPromptTemplate.fromMessages([
    ["system", QA_CHAIN_TEMPLATE],
    new MessagesPlaceholder("history"),
    ["human", "{question}"]
  ]);
};

const createAnswerChain = (llm: RunnableLike, retriever: RunnableLike, userRole: string) => {
  const contextSummaryChain = createContextSummaryChain(llm);
  const answerGenerationPrompt = createAnswerGenerationPrompt();

  return RunnableSequence.from([
    RunnablePassthrough.assign({
      context: async (input: Record<string, unknown>) => {
        if ("history" in input) {
          const chain = contextualizedQuestion(input, { llm }) as RunnableSequence;
          const docs = await chain.pipe(retriever).invoke(input) as Document[]
          return convertDocsToWrappedString(docs);
        }
        return "";
      },
    }),
    RunnablePassthrough.assign({
      internal_processing: async (input: Record<string, string>) => {
        console.log("The asking user is " + userRole);
        const summary = await contextSummaryChain.invoke({
          user_info: "The asking user is " + userRole,
          context: input.context,
          question: input.question
        });
        console.log("🚀 ~ user_rights: ~ summary:", summary.content)

        return summary.content;
      }
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