
import { ChatOpenAI } from "@langchain/openai";
import { ChatMessageHistory } from "langchain/memory";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableSequence, RunnablePassthrough, RunnableWithMessageHistory, RunnableConfig } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { QA_CHAIN_TEMPLATE, REPHRASE_QUESTION_SYSTEM_TEMPLATE, SELF_REFINE_FEEDBACK_TEMPLATE, SELF_REFINE_REFINE_TEMPLATE } from './consts';
import { UpstashRedisChatMessageHistory } from "@langchain/community/stores/message/upstash_redis";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { formatDocumentsAsString } from "langchain/util/document";
import { convertDocsToWrappedString } from "./convert-docs-to-string";

export const composeConversationalContextChain = async (
  sessionId: string,
  messageHistory: ChatMessageHistory,
  retrievalChain: RunnableSequence<{
    question: string;
  }, string>,
  retriever: any
) => {
  const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0 });

  // prompt = system + history + human messages
  const contextualizedQPrompt = ChatPromptTemplate.fromMessages([
    ["system", REPHRASE_QUESTION_SYSTEM_TEMPLATE],
    new MessagesPlaceholder("history"),
    [
      "human",
      "{question}"
    ],
  ]);

  const contextualizedQChain = contextualizedQPrompt.pipe(llm).pipe(new StringOutputParser());

  const contextualizedQuestion = (input: Record<string, unknown>) => {
    if ("history" in input) {
      return contextualizedQChain;
    }
    return input.question;
  };

  // const res = await rephraseQuestionChain.invoke({
  //   history: [
  //     new HumanMessage("What does LLM stand for?"),
  //     new AIMessage("Large language model"),
  //   ],
  //   question: "What is meant by large",
  // });

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
          const chain = contextualizedQuestion(input) as RunnableSequence;
          // @ts-ignore
          return chain.pipe(retriever).pipe(convertDocsToWrappedString);
        }
        return "";
      },
    }),
    answerGenerationPrompt,
    llm,
  ]);

  // TODO: requires answer
  const feedbackPrompt = ChatPromptTemplate.fromMessages([
    ["system", SELF_REFINE_FEEDBACK_TEMPLATE],
    new MessagesPlaceholder("history"),
    [
      "human",
      "Provide feedback on this generated answer:\n{answer}"
    ]
  ]);

  const refinePrompt = ChatPromptTemplate.fromMessages([
    ["system", SELF_REFINE_REFINE_TEMPLATE],
    new MessagesPlaceholder("history"),
    [
      "human",
      "Refine the answer based on the feedback:\nOriginal answer: {answer}\nFeedback: {feedback}"
    ]
  ]);

  const feedbackChain = feedbackPrompt.pipe(new RunnablePassthrough()).pipe(llm).pipe(new StringOutputParser());
  const refinedQAChain = refinePrompt.pipe(new RunnablePassthrough()).pipe(llm).pipe(new StringOutputParser());

  // let chat_history = [];
  // const originalAnswer = (await answerChain.invoke({ chat_history: [], question: "How to generate an idea?" })).content;
  // console.log("🚀 ~ originalAnswer:", originalAnswer)

  // chat_history = chat_history.concat(refinedAnswer);


  // const answerGenerationPrompt = ChatPromptTemplate.fromMessages([
  //   ["system", QA_CHAIN_TEMPLATE],
  //   new MessagesPlaceholder("history"),
  //   [
  //     "human",
  //     "Now, answer this question using the previous context and chat history:\n{question}"
  //   ]
  // ]);

  // const feedbackPrompt = ChatPromptTemplate.fromMessages([
  //   ["system", SELF_REFINE_FEEDBACK_TEMPLATE],
  //   new MessagesPlaceholder("history"),
  //   [
  //     "human",
  //     "Provide feedback on this generated answer:\n{answer}"
  //   ]
  // ]);

  // const refinePrompt = ChatPromptTemplate.fromMessages([
  //   ["system", SELF_REFINE_REFINE_TEMPLATE],
  //   new MessagesPlaceholder("history"),
  //   [
  //     "human",
  //     "Refine the answer based on the feedback:\nOriginal answer: {answer}\nFeedback: {feedback}"
  //   ]
  // ]);

  // const retrivalRes = await retrievalChain.invoke({ question: 'How to add a new idea?' })

  // const answerChain = RunnableSequence.from([
  //   RunnablePassthrough.assign({
  //     question: rephraseQuestionChain,
  //     context: retrievalChain,
  //   }),
  //   answerGenerationPrompt,
  //   new ChatOpenAI(),
  //   new StringOutputParser(),
  // ]);

  // console.log(await answerChain.invoke({ question: "How to add a new idea?" }));

  // const feedbackChain = RunnableSequence.from([
  //   RunnablePassthrough.assign({
  //     answer: answerChain,
  //   }),
  //   feedbackPrompt,
  //   new ChatOpenAI(),
  //   new StringOutputParser(),
  // ])
  // console.log("🚀 ~ feedbackChain:", feedbackChain)

  // const refinedQAChain = RunnableSequence.from([
  //   RunnablePassthrough.assign({
  //     answer: answerChain,
  //     feedback: feedbackChain,
  //   }),
  //   new ChatOpenAI(),
  //   new StringOutputParser(),
  // ])

  const chainWithHistory = new RunnableWithMessageHistory({
    runnable: answerChain,
    getMessageHistory: (_sessionId: string) => messageHistory,
    // getMessageHistory: (sessionId) =>
    //   new UpstashRedisChatMessageHistory({
    //     sessionId,
    //     config: {
    //       url: process.env.UPSTASH_REDIS_REST_URL!,
    //       token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    //     },
    //   }),
    inputMessagesKey: "question",
    historyMessagesKey: "history",
  });

  // // Whenever we call our chain with message history, we need to include an additional config object that contains the session_id
  const config: RunnableConfig = { configurable: { sessionId } }

  return async (followUpQuestion: string) => {
    const res = await chainWithHistory.invoke(
      { question: followUpQuestion },
      config
    );

    const originalAnswer = res.content;
    console.log("🚀 ~ return ~ originalAnswer:", originalAnswer)

    const feedback = await feedbackChain.invoke({ history: chainWithHistory.getMessageHistory(), answer: originalAnswer });
    console.log("🚀 ~ feedback:", feedback)
    const refinedAnswer = await refinedQAChain.stream({ history: chainWithHistory.getMessageHistory(), answer: originalAnswer, feedback: feedback });
    console.log("🚀 ~ refinedAnswer:", refinedAnswer)

    return refinedAnswer;
  }
};