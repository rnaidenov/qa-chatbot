import { Client } from '@notionhq/client';
import * as path from 'path';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function getImageUrlsFromPage(pageId: string): Promise<Map<string, string>> {
  const imageUrls = new Map<string, string>();
  let cursor: string | undefined;

  do {
    const response: any = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
    });

    for (const block of response.results) {
      if (block.type === 'image') {
        const fileName = path.basename(block.image.file?.url || '');
        const url = block.image.file?.url || block.image.external?.url;
        if (url && fileName) {
          imageUrls.set(fileName, url);
        }
      }
    }

    cursor = response.next_cursor;
  } while (cursor);

  return imageUrls;
}

function extractPageId(source: string): string | null {
  const pageIdRegex = /[a-f0-9]{32}/i;
  const match = source.match(pageIdRegex);
  return match ? match[0] : null;
}

export async function ensureCorrectlyReferencedImages(content: string, source: string): Promise<string> {
  const pageId = extractPageId(source);

  if (!pageId) {
    console.log(`Could not extract page ID from source: ${source}`);
    return content;
  }

  console.log(`Fetching images for page: ${pageId}`);
  const imageUrls = await getImageUrlsFromPage(pageId);

  const imageUrlArray = Array.from(imageUrls.values());

  let updatedContent = content;

  for (const url of imageUrlArray) {
    const fileName = url.split('/')?.pop()?.split('?')[0];
    updatedContent = updatedContent.replace(`(${fileName})`, `(${url})`);
  }


  return updatedContent;
}