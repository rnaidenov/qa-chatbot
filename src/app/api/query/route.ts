import { StreamingTextResponse } from 'ai';


// const handleResponse = async (sessionId: string, question: string): Promise<any> => {
//   const myHeaders = new Headers();
//   myHeaders.append("Authorization", "Bearer sk-7136a4d70407ebec38da3c04219ec97a");
//   myHeaders.append("Content-Type", "application/json");
//   myHeaders.append("Cookie", "GCLB=CI2rxb3nvMGboAEQAw");

//   const raw = JSON.stringify({
//     "specification_hash": "3b82455005a94d4b2dfaf53199c3d4e1d26c316ac443ee47f7c3123e4bf142d2",

//     // old, before instructions:
//     // "specification_hash": "94c595999c928302faec50c5786bb30e9c28c34ad4a7f424f1c0463d790a489a",
//     "config": {
//       "DATASOURCE": {
//         "data_sources": [
//           {
//             "workspace_id": "94ab6f9a73",
//             "data_source_id": "public-faq"
//           }
//         ],
//         "top_k": 8,
//         "filter": {
//           "tags": null,
//           "timestamp": null
//         },
//         "use_cache": false
//       },
//       "MODEL": {
//         "provider_id": "openai",
//         "model_id": "gpt-4-1106-preview",
//         "function_call": null,
//         "use_cache": true
//       }
//     },
//     "blocking": true,
//     "inputs": [
//       {
//         "question": question
//       }
//     ]
//   });

//   const requestOptions = {
//     method: 'POST',
//     headers: myHeaders,
//     body: raw,
//   };

//   try {
//     const response = await fetch("https://dust.tt/api/v1/w/94ab6f9a73/apps/9446a032e0/runs", requestOptions);
//     const result = await response.json();
//     return result.run.results[0][0].value;
//   } catch (error) {
//     console.error('error', error);
//     throw error;
//   }
// }




const postMessage = async (question: string) => {
  var myHeaders = new Headers();
  myHeaders.append("Authorization", `Bearer ${process.env.DUST_API_KEY}`);
  myHeaders.append("Content-Type", "application/json");

  var raw = JSON.stringify({
    "content": `:mention[HomaSage]{sId=0dff0c7e5f} ${question}`,
    "mentions": [
      {
        "configurationId": "fb859f3a05"
      }
    ],
    "context": {
      "timezone": "Europe/Paris",
      "username": "rnaidenov",
      "email": null,
      "fullName": "I can put anything here",
      "profilePictureUrl": "https://dust.tt/static/systemavatar/helper_avatar_full.png"
    }
  });

  var requestOptions = {
    method: 'POST',
    headers: myHeaders,
    body: raw,
  };

  try {
    const response = await fetch("https://dust.tt/api/v1/w/94ab6f9a73/assistant/conversations/7c5fb7a4a0/messages", requestOptions);
    const result = await response.text();
    console.log(result);
  } catch (error) {
    console.log('error', error);
  }
}

const getLatestAgentMessageId = async () => {
  const data = await fetch('https://dust.tt/api/v1/w/94ab6f9a73/assistant/conversations/7c5fb7a4a0', {
    headers: {
      'Authorization': `Bearer ${process.env.DUST_API_KEY}`
    }
  }).then(res => res.json());

  const latestMessage = data.conversation.content[data.conversation.content.length - 1][0]

  return latestMessage.sId;
}

const streamMessages = async (agentMessageId: string, onText: (text: string) => void) => {
  try {
    const streamResponse = await fetch(`https://dust.tt/api/v1/w/94ab6f9a73/assistant/conversations/7c5fb7a4a0/messages/${agentMessageId}/events`, {
      headers: {
        'Authorization': `Bearer ${process.env.DUST_API_KEY}`
      }
    });

    if (!streamResponse.body) {
      throw new Error('Stream response body is undefined');
    }

    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      let { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data:') && line.includes('"type":"generation_tokens"')) {
          const jsonData = line.slice(5).trim();
          console.log("🚀 ~ streamMessages ~ jsonData:", jsonData);

          try {
            const data = JSON.parse(jsonData);
            if (data.data) {
              const text = data.data.text;
              onText(text);
            }
          } catch (error) {
            console.error('Error parsing JSON data:', error);
          }
        }
      }
    }

    console.log('Streaming completed.');
  } catch (error) {
    console.error('Error in streamMessages:', error);
    throw error;
  }
};

const handleResponse = async (sessionId: string, question: string, onText: (text: string) => void): Promise<void> => {
  await postMessage(question);
  const latestMessageId = await getLatestAgentMessageId();

  await streamMessages(latestMessageId, onText);
}

export async function POST(req: Request) {
  try {
    const { sessionId, question } = await req.json();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const onText = (text: string) => {
          const chunk = encoder.encode(text);
          controller.enqueue(chunk);
        };

        await handleResponse(sessionId, question, onText);
        controller.close();
      }
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    console.error('Error in POST /api/query:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}


export const dynamic = 'force-dynamic';
export const maxDuration = 60;
