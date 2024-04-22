import { ChatOpenAI } from "langchain/chat_models/openai";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";

export const openAISetup = (modelName?: string) => {
  const model = new ChatOpenAI({
    modelName: modelName ?? process.env.OPENAI_MODEL_NAME ?? "gpt-3.5-turbo-1106",
  });
  const embeddings = new OpenAIEmbeddings();

  return {
    model,
    embeddings
  }
};