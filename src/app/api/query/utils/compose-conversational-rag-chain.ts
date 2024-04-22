import { ChatOpenAI } from "langchain/chat_models/openai";
import { ChatMessageHistory } from "langchain/memory";
import { ChatPromptTemplate, MessagesPlaceholder } from "langchain/prompts";
import { RunnableSequence, RunnablePassthrough, RunnableWithMessageHistory, RunnableConfig } from "langchain/runnables";
import { StringOutputParser } from "langchain/schema/output_parser";
import { QA_CHAIN_TEMPLATE, REPHRASE_QUESTION_SYSTEM_TEMPLATE } from '../consts';

export const composeConversationalContextChain = async (
  sessionId: string,
  messageHistory: ChatMessageHistory,
  retrievalChain: RunnableSequence<{
    standalone_question: string;
  }, string>
) => {
  // prompt = system + history + human messages
  const rephraseQuestionPrompt = ChatPromptTemplate.fromMessages([
    ["system", REPHRASE_QUESTION_SYSTEM_TEMPLATE],
    new MessagesPlaceholder("history"),
    [
      "human",
      "Rephrase the following question as a standalone question:\n{question}"
    ],
  ]);

  const rephraseQuestionChain = RunnableSequence.from([
    rephraseQuestionPrompt,
    /**
     *  Sampling temperature is a parameter used in machine learning models, particularly in language generation, to control the randomness of predictions by scaling the logits before applying softmax. When generating text:
        A low temperature (close to 0) makes the model more confident in its predictions, leading to more repetitive and predictable text.
        A high temperature increases randomness, making the model more likely to sample diverse or surprising words, leading to more varied and creative text.
        A temperature of 1 means no scaling and is considered a neutral temperature, providing a balance between randomness and predictability.
     */
    new ChatOpenAI({ temperature: 0.1, modelName: "gpt-3.5-turbo-1106" }),
    new StringOutputParser(),
  ]);

  const answerGenerationPrompt = ChatPromptTemplate.fromMessages([
    ["system", QA_CHAIN_TEMPLATE],
    new MessagesPlaceholder("history"),
    [
      "human",
      "Now, answer this question using the previous context and chat history:\n{standalone_question}"
    ]
  ]);

  // RunnablePassthrough is used to pass down the input to the next runnable
  // e.g. RunnablePassthrough(...) -> answerGenerationPrompt.invoke(RunnablePassthrough.output)


  // input to conversationalRetrievalChain with "standalone_question" and "context" keys 
  // get directly passed down to rephraseQuestionChain and retrievalChain
  const conversationalRetrievalChain = RunnableSequence.from([
    RunnablePassthrough.assign({
      standalone_question: rephraseQuestionChain,
      context: retrievalChain,
    }),
    answerGenerationPrompt,
    new ChatOpenAI(),
    new StringOutputParser(),
  ]);

  const withHistory = new RunnableWithMessageHistory({
    runnable: conversationalRetrievalChain,
    // TODO: Integrate Redis
    getMessageHistory: (_sessionId: string) => messageHistory,
    inputMessagesKey: "question",
    // Shows the runnable where to insert the message history
    // Here we have "history" because of the above MessagesPlaceholder
    historyMessagesKey: "history",
  });

  const config: RunnableConfig = { configurable: { sessionId } }

  return async (followUpQuestion: string) => {
    const finalResult = await withHistory.stream(
      { question: followUpQuestion },
      config
    );

    return finalResult;
  }
}

