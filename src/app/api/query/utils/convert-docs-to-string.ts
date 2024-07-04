import { Document } from "langchain/document";

export const convertDocsToWrappedString = (input: Document[] | string[]): string => {
  return input.map((el) => {
    return `<doc>\n${typeof el === 'string' ? el : el.pageContent}\n</doc>`
  }).join("\n");
};