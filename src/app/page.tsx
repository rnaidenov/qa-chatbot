'use client';

import { useEffect, useState, KeyboardEvent, useRef, ChangeEvent } from 'react';
import { IoSend } from 'react-icons/io5';
import { IoThumbsUpSharp } from "react-icons/io5";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mixpanel from 'mixpanel-browser';

mixpanel.init(process.env.NEXT_PUBLIC_MIXPANEL_TOKEN as string);
mixpanel.set_config({ persistence: "localStorage" });

interface Message {
  text: string;
  sender: 'user' | 'bot';
  loading?: boolean;
}

interface Rating {
  value: number;
  comment: string;
}

const INITIAL_BOT_MESSAGE = "Hi, I'm HomaSage 🧙‍♂️ ! Ask me anything on the existing Knowledge Base that was recently ported to Notion 🧠"

export default function Home() {
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRatingVisibleFor, setIsRatingVisibleFor] = useState<number | null>(null);
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const [rating, setRating] = useState<Rating>({ value: 5, comment: '' });
  const [alreadyRated, setAlreadyRated] = useState<Set<number>>(new Set());

  const lastBotMessagePerformance = useRef<number>(0);


  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  const [isAnswering, setIsAnswering] = useState(false);
  const chatBoxRef = useRef<HTMLInputElement>(null);

  const sendMessage = () => {
    if (message.trim()) {
      setMessages([...messages, { text: message, sender: 'user' }]);
      setMessage('');
    }
  };

  const handleKeyPress = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      sendMessage();
    }
  };

  const handleRatingChange = (event: ChangeEvent<HTMLInputElement>) => {
    setRating({ ...rating, value: parseInt(event.target.value) });
  };

  const handleCommentChange = (event: ChangeEvent<HTMLInputElement>) => {
    setRating({ ...rating, comment: event.target.value });
  };

  const submitRating = () => {
    if (!isRatingVisibleFor) {
      return;
    }

    const sessionId = localStorage.getItem('sessionId');
    const question = messages.find((msg, index) => index === isRatingVisibleFor - 1)?.text || '';
    const response = messages.find((msg, index) => index === isRatingVisibleFor)?.text || '';

    mixpanel.track('[HomaSage]: Rating Submitted', {
      sessionId: sessionId,
      rating: rating.value,
      comment: rating.comment,
      question: question,
      response: response,
      chatHistory: messages,
      model: 'langchain'
    });

    setAlreadyRated((alreadyRated) => alreadyRated.add(isRatingVisibleFor));
    setIsRatingVisibleFor(null);
    setRating({ value: 5, comment: '' });
  };

  useEffect(() => {
    setMessages([{ text: '...', sender: 'bot', loading: true }]);

    setTimeout(() => {
      setMessages([{ text: INITIAL_BOT_MESSAGE, sender: 'bot' }]);
    }, 1000);

    if (!localStorage.getItem('sessionId')) {
      localStorage.setItem('sessionId', Date.now().toString());
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom();
    }, 0);

    return () => clearTimeout(timer);
  }, [messages]);

  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].sender === 'user') {
      setIsAnswering(true);
      const start = performance.now();

      setMessages([
        ...messages,
        {
          text: '...',
          sender: 'bot',
          loading: true,
        }
      ]);

      const fetchAndProcessResponse = async () => {
        if (messages.length < 2) {
          return;
        }

        let lastMessageUpdate = messages[messages.length - 1];

        try {
          const response = await fetch('/api/query', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sessionId: localStorage.getItem('chat-bot-session-id') || Date.now().toString(), question: messages[messages.length - 1].text }),
          });

          if (!response.body) {
            throw new Error('No response body');
          }

          const reader = response.body.getReader();
          let done, value;
          while ({ done, value } = await reader.read(), !done) {
            const text = new TextDecoder().decode(value);
            setMessages((currentMessages) => {
              const lastMessage = currentMessages[currentMessages.length - 1];
              lastMessageUpdate = {
                ...lastMessage,
                text: (lastMessage.text === '...' ? '' : lastMessage.text) + text,
                loading: false
              };

              return currentMessages.slice(0, -1).concat(lastMessageUpdate);
            });
          }
        } catch (error) {
          console.error('Error in POST /api/query:', error);
        } finally {
          setIsAnswering(false);
          lastBotMessagePerformance.current = performance.now() - start;

          const question = messages[messages.length - 1];

          mixpanel.track('[HomaSage]: Track performance', {
            sessionId: localStorage.getItem('sessionId'),
            performanceMilliseconds: lastBotMessagePerformance.current,
            model: 'langchain',
            question,
            response: lastMessageUpdate,
            responseCharsCount: lastMessageUpdate.text.length
          })
        }
      };

      fetchAndProcessResponse();
    }
  }, [messages]);


  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-[#00171F]">
      <div className="relative flex w-full max-w-2xl border bg-[#FBF5F3] rounded-md overflow-auto" style={{ height: '500px', width: '800px' }}>
        <div className="flex flex-1 flex-col border-rounded p-2 overflow-y-auto" style={{ maxHeight: '500px' }}>
          {messages.map((msg, index) => (
            <div key={index} className={`relative animate-fade-in mb-2 ${msg.sender === 'bot' ? 'self-start' : 'self-end'}${index === messages.length - 1 ? ' mb-[10%]' : ''}${msg.loading ? ' animate-pulse' : ''}`}>
              {msg.sender === 'bot' ? (
                <div className={`inline-block px-4 py-2 rounded-md bg-[#D68FD6] transition-all duration-300 ease-in-out hover:cursor-pointer hover:bg-[#8E518D]${alreadyRated.has(index) ? ' bg-[#8E518D]' : ''}`}
                  onMouseOver={() => (index !== 0 && msg.text !== '...' && !alreadyRated.has(index)) && setIsRatingVisibleFor(index)}
                  onMouseLeave={() => setIsRatingVisibleFor(null)}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.text}
                  </ReactMarkdown>
                  {
                    alreadyRated.has(index) && (
                      <p className="text-xs mt-4 italic animate-fade-in">You have rated this response.</p>
                    )
                  }
                  {
                    isRatingVisibleFor === index && (
                      <div className="animate-fade-in relative bottom-0 left-0 right-0 p-2 border-top mt-4">
                        <p className="text-xs mt-1">Rate this response</p>
                        <div className="flex gap-8 items-center">
                          <div>
                            <div className='flex items-center mb-4'>
                              <label className="text-xs font-medium text-[#CC8FAB]">Terrible</label>
                              <input type="range" min="0" max="10" defaultValue="5" className="slider mx-2" onChange={handleRatingChange} />
                              <label className="text-xs font-medium text-[#CC8FAB]"><b>Awesome</b></label>
                            </div>
                            <input
                              type="text"
                              className='block w-full text-black p-2 rounded-sm'
                              placeholder="Any optional comments?"
                              onChange={handleCommentChange}
                            />
                          </div>
                          <button
                            onClick={submitRating}
                            className="ml-2 bg-[#622D46] hover:bg-[#462032] text-white font-bold py-1 px-2 rounded"
                          >
                            <IoThumbsUpSharp />
                          </button>
                        </div>
                      </div>
                    )
                  }
                </div>
              ) : (
                <span className="inline-block px-4 py-2 rounded-md bg-[#7E9181] text-white">
                  {msg.text}
                </span>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} id='msgEndRef' />
        </div>
        <div className="flex w-full max-w-2xl mt-4 h-[10%] absolute bottom-0">
          <input
            type="text"
            ref={chatBoxRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Type a message..."
            className="flex-1 p-2 border-t border-b border-l text-gray-800 rounded-bl-md"
          />
          <button
            onClick={sendMessage}
            disabled={!message.trim() || isAnswering}
            className="bg-[#7E9181] hover:bg-[#588157] text-white p-2 border border-blue-500 rounded-br-md"
          >
            <IoSend />
          </button>
        </div>
      </div>
    </main>
  );
}