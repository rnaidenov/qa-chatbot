import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { REPHRASE_QUESTION_SYSTEM_TEMPLATE } from "./consts";
import { RunnableLike } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";

// prompt = system + history + human messages
const contextualizedQPrompt = ChatPromptTemplate.fromMessages([
  ["system", REPHRASE_QUESTION_SYSTEM_TEMPLATE],
  new MessagesPlaceholder("history"),
  [
    "human",
    "{question}"
  ],
]);

const contextualizedQChain = (llm: RunnableLike) => contextualizedQPrompt.pipe(llm).pipe(new StringOutputParser());

export const contextualizedQuestion = (input: Record<string, unknown>, opts?: { llm: RunnableLike }) => {
  if ("history" in input) {
    return contextualizedQChain(opts?.llm ?? new ChatOpenAI({ model: "gpt-3.5-turbo-0125", temperature: 0 }));
  }
  return input.question;
};
