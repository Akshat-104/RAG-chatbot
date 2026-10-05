import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { 
  Brain, 
  CloudUpload, 
  FileText, 
  Trash2, 
  Send, 
  Sparkles, 
  GraduationCap, 
  Bot, 
  User, 
  Bookmark, 
  CheckCircle2, 
  AlertTriangle, 
  Info, 
  Menu, 
  X,
  FileCheck
} from 'lucide-react';

export default function App() {
  // State management
  const [documents, setDocuments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState('');
  
  const [messages, setMessages] = useState(()=>{
    const savedMessages = localStorage.getItem('chat_history');
    if(savedMessages){
      try{
        return JSON.parse(savedMessages);
      }catch(error){
        console.log(error);
      }
    }
    return [
      {
      id: 1,
      sender: 'assistant',
      text: "Hello! I am your RAG Document Assistant built with React. Upload your PDF notes or documents on the sidebar, and I will chunk, embed, and store them securely in MongoDB Atlas. Once ready, ask me anything or request detailed explanations based exclusively on your materials!",
      citations: []
    }
    ]
  });
  
  const [inputQuery, setInputQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  
  const chatScrollRef = useRef(null);

  useEffect(()=>{
    localStorage.setItem('chat_history',JSON.stringify(messages));
  },[messages])

  useEffect(() => {
  async function fetchIndexedDocuments() {
    try {
      const response = await fetch('http://localhost:4444/api/documents');
      const data = await response.json();
      if (data.success) {
        const formattedDocs = data.filenames.map((name, index) => ({
          id: index,
          name: name,
          size: 'Indexed File',
          chunks: 'Stored in DB'
        }));
        setDocuments(formattedDocs);
      }
    } catch (error) {
      console.error('Could not fetch documents from server', error);
    }
  }
  fetchIndexedDocuments();
}, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, isGenerating]);

  // Toast notification helper
  const triggerToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 3500);
  };

  const handleFileUpload = async (file) => {
    if (isUploading) return;
    setIsUploading(true);
    setUploadProgress(20);
    setUploadStatusText("Uploading and extracting text...");

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:4444/api/upload', {
        method: 'POST',
        body: formData,
      });

      setUploadProgress(75);
      setUploadStatusText("Generating embeddings & storing in MongoDB...");

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload file');
      }

      setUploadProgress(100);
      
      setTimeout(() => {
        setIsUploading(false);
        const newDoc = {
          id: Date.now(),
          name: file.name,
          size: formatFileSize(file.size),
          chunks: 'Indexed'
        };
        setDocuments(prev => [newDoc, ...prev]);
        triggerToast(`Successfully stored "${file.name}" in database!`, 'success');
      }, 500);

    } catch (error) {
      console.error('Upload Error:', error);
      setIsUploading(false);
      triggerToast(error.message || 'Error uploading file', 'error');
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const removeDocument = async(id , filename) => {
    const response = await fetch(`http://localhost:4444/api/documents/${encodeURIComponent(filename)}`,{
      method:'DELETE'
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Failed to delete document from server');
      }
    setDocuments(prev => prev.filter(d => d.id !== id));
    triggerToast('Document removed from vector store.', 'info');
  };

  const handleUserSubmit = (e) => {
    e.preventDefault();
    if (!inputQuery.trim() || isGenerating) return;

    if (documents.length === 0) {
      triggerToast('Please upload at least one document first to provide RAG context!', 'error');
      return;
    }

    const userText = inputQuery.trim();
    setInputQuery('');

    // Append user message
    const userMsgId = Date.now();
    setMessages(prev => [...prev, { id: userMsgId, sender: 'user', text: userText, citations: [] }]);

    // Trigger assistant response with simulated SSE stream
    triggerAssistantStreamResponse(userText);
  };

  const triggerAssistantStreamResponse = async (query) => {
    setIsGenerating(true);
    const assistantMsgId = Date.now() + 1;

    setMessages(prev => [
      ...prev, 
      { id: assistantMsgId, sender: 'assistant', text: '', citations: [] }
    ]);

    try {
      const response = await fetch('http://localhost:4444/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate response from backend');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedAnswer = '';
      let accumulatedCitations = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.replace('data: ', '').trim();
            if (jsonStr === '[DONE]') break;

            try {
              const parsed = JSON.parse(jsonStr);

              // Capture citations if metadata packet arrives
              if (parsed.type === 'metadata' && parsed.citations) {
                accumulatedCitations = parsed.citations.map(c => `${c} (MongoDB Vector Search Match)`);
              }

              // Capture text tokens
              if (parsed.type === 'text' || parsed.text) {
                accumulatedAnswer += (parsed.text || '');
              }

              // Live update of message state
              setMessages(prev => prev.map(msg => {
                if (msg.id === assistantMsgId) {
                  return { 
                    ...msg, 
                    text: accumulatedAnswer, 
                    citations: accumulatedCitations.length > 0 ? accumulatedCitations : msg.citations 
                  };
                }
                return msg;
              }));
            } catch (e) {
              // Ignore partial JSON chunks during streaming
            }
          }
        }
      }

    } catch (error) {
      console.error('Chat Stream Error:', error);
      setMessages(prev => prev.map(msg => {
        if (msg.id === assistantMsgId) {
          return { ...msg, text: '⚠️ Error: Failed to connect to the backend server.' };
        }
        return msg;
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  const generateMockRAGResponse = (query) => {
    const q = query.toLowerCase();
    if (q.includes('summarize') || q.includes('summary')) {
      return "Based on your uploaded documents, the core concepts revolve around structured RAG (Retrieval-Augmented Generation) pipelines. The texts outline text extraction, semantic chunking strategies with overlap preservation, vector embedding generation, and high-performance similarity querying using MongoDB Atlas Vector Search.";
    } else if (q.includes('beginner') || q.includes('explain')) {
      return "Think of a RAG system like an open-book exam for an AI. Instead of relying solely on what the AI memorized beforehand, RAG first searches your specific documents for the exact paragraphs relevant to your question, feeds those paragraphs to the AI as context, and asks it to formulate an accurate answer.";
    } else {
      return `Based on the relevant text chunks retrieved from your uploaded documents, here is the detailed answer to your query: "${query}". The indexed vector database indicates clear alignment with your notes, emphasizing structured data storage, context retrieval, and token streaming via Server-Sent Events.`;
    }
  };

  const clearChat = () => {
    const iniMsg = [
      {
      id: Date.now(),
      sender: 'assistant',
      text: "Hello! I am your RAG Document Assistant built with React. Upload your PDF notes or documents on the sidebar, and I will chunk, embed, and store them securely in MongoDB Atlas. Once ready, ask me anything or request detailed explanations based exclusively on your materials!",
      citations: []
    }
    ];
    setMessages(iniMsg);
    localStorage.removeItem('chat_history');
    triggerToast('Chat history cleared.', 'info');
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans antialiased overflow-hidden">

      {/* Sidebar for Document Management & Upload */}
      <aside className={`w-80 bg-slate-900 border-r border-slate-800 flex flex-col justify-between transition-all duration-300 z-30 md:relative absolute inset-y-0 left-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        
        {/* Sidebar Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight text-white">DocMind AI</h1>
              <p className="text-xs text-slate-400">RAG Knowledge Hub</p>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-slate-400 hover:text-white p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Upload Box & Active Files Section */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* Upload Dropzone */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Add Documents</label>
            <div 
              className="border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl p-5 text-center cursor-pointer transition-all duration-200 bg-slate-950/40 hover:bg-slate-800/40 group relative overflow-hidden"
              onClick={() => document.getElementById('fileInput').click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.[0]) handleFileUpload(e.dataTransfer.files[0]);
              }}
            >
              <input 
                type="file" 
                id="fileInput" 
                className="hidden" 
                accept=".pdf,.txt,.docx,.md" 
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                }} 
              />
              <div className="space-y-2 pointer-events-none">
                <div className="mx-auto w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-200 text-indigo-400">
                  <CloudUpload className="w-6 h-6" />
                </div>
                <div className="text-sm">
                  <span className="font-medium text-indigo-400">Click to upload</span> or drag and drop
                </div>
                <p className="text-xs text-slate-500">PDF, TXT, DOCX up to 25MB</p>
              </div>
            </div>
          </div>

          {/* Loading State Indicator */}
          {isUploading && (
            <div className="bg-slate-800/80 border border-indigo-500/30 rounded-xl p-4 space-y-3 shadow-md backdrop-blur-sm animate-pulse">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-xs font-medium text-indigo-300">{uploadStatusText}</span>
                </div>
                <span className="text-xs font-bold text-indigo-400">{uploadProgress}%</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
              </div>
              <p className="text-[11px] text-slate-400 italic">Extracting embeddings & storing in MongoDB...</p>
            </div>
          )}

          {/* Uploaded Documents List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Uploaded Sources</span>
              <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">{documents.length} files</span>
            </div>
            <div className="space-y-2">
              {documents.length === 0 ? (
                <div className="text-xs text-slate-500 text-center py-6 border border-slate-800/50 rounded-xl bg-slate-950/20">
                  No documents uploaded yet. Add notes to start chatting!
                </div>
              ) : (
                documents.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs group hover:border-slate-700 transition">
                    <div className="flex items-center space-x-2.5 overflow-hidden">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center flex-shrink-0">
                        <FileCheck className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <p className="font-medium text-slate-200 truncate">{doc.name}</p>
                        <p className="text-[10px] text-slate-400">{doc.size} • {doc.chunks} chunks indexed</p>
                      </div>
                    </div>
                    <button onClick={() => removeDocument(doc.id , doc.name)} className="text-slate-500 hover:text-red-400 p-1 opacity-0 group-hover:opacity-100 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-800 text-xs text-slate-500 flex items-center justify-between">
          <span>MongoDB Vector DB Active</span>
          <span className="flex items-center space-x-1 text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Ready</span>
          </span>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col h-full bg-slate-950 relative overflow-hidden">
        
        {/* Top Navigation Bar */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md px-6 flex items-center justify-between z-10">
          <div className="flex items-center space-x-3">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden text-slate-400 hover:text-white p-1 rounded-lg">
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h2 className="font-semibold text-sm text-slate-200 flex items-center space-x-2">
                <span>Knowledge Assistant</span>
                <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full font-normal">RAG Context Enabled</span>
              </h2>
              <p className="text-xs text-slate-400">Ask questions or request explanations from your stored docs</p>
            </div>
          </div>

          <button onClick={clearChat} title="Clear Chat History" className="text-slate-400 hover:text-white text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 px-3 py-2 rounded-xl transition flex items-center space-x-1.5">
            <Trash2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden sm:inline">Clear Chat</span>
          </button>
        </header>

        {/* Chat Message Scrollable Container */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            return (
              <div key={msg.id} className={`flex items-start space-x-3 max-w-3xl ${isUser ? 'ml-auto flex-row-reverse space-x-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-xl ${isUser ? 'bg-violet-600' : 'bg-indigo-600'} flex-shrink-0 flex items-center justify-center text-white shadow-md`}>
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div className="space-y-1.5 flex-1 overflow-hidden">
                  <div className={`${isUser ? 'bg-violet-600/25 border-violet-500/30 text-slate-100 rounded-tr-sm' : 'bg-slate-900 border-slate-800 text-slate-200 rounded-tl-sm'} border rounded-2xl p-4 text-sm shadow-sm leading-relaxed overflow-x-auto`}>
  {isUser ? (
    <div className="whitespace-pre-wrap">{msg.text}</div>
  ) : (
    <ReactMarkdown 
      remarkPlugins={[remarkGfm, remarkMath]} 
      rehypePlugins={[rehypeKatex]}
      components={{
  h3: ({node, ...props}) => <h3 className="text-indigo-400 font-bold text-base mt-4 mb-2 first:mt-0" {...props} />,
  h4: ({node, ...props}) => <h4 className="text-slate-100 font-semibold text-sm mt-3 mb-1" {...props} />,
  p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />,
  ul: ({node, ...props}) => <ul className="list-disc list-inside space-y-1.5 my-2 text-slate-300" {...props} />,
  ol: ({node, ...props}) => <ol className="list-decimal list-inside space-y-1.5 my-2 text-slate-300" {...props} />,
  li: ({node, ...props}) => <li className="text-slate-300" {...props} />,
  strong: ({node, ...props}) => <strong className="text-slate-100 font-semibold" {...props} />,
  blockquote: ({node, ...props}) => <blockquote className="border-l-2 border-indigo-500 pl-3 my-2 text-slate-400 italic" {...props} />,
  table: ({node, ...props}) => <div className="overflow-x-auto my-3"><table className="w-full text-left border-collapse text-xs" {...props} /></div>,
  th: ({node, ...props}) => <th className="bg-slate-950 px-3 py-2 border border-slate-800 text-slate-200 font-semibold" {...props} />,
  td: ({node, ...props}) => <td className="px-3 py-2 border border-slate-800 text-slate-300" {...props} />,
  hr: ({node, ...props}) => <hr className="border-slate-800 my-4" {...props} />,
  code: ({node, inline, ...props}) => 
    inline ? 
      <code className="bg-slate-950 px-1.5 py-0.5 rounded text-indigo-300 font-mono text-xs" {...props} /> :
      <code className="block bg-slate-950 p-3 rounded-xl font-mono text-xs text-indigo-300 overflow-x-auto my-2" {...props} />
}}
    >
      {msg.text}
    </ReactMarkdown>
  )}
  {isGenerating && !isUser && msg === messages[messages.length - 1] && (
    <span className="inline-block w-1.5 h-3.5 bg-indigo-500 ml-1 animate-pulse align-middle"></span>
  )}
</div>
                  
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-800 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-400 font-medium flex items-center"><Bookmark className="w-3 h-3 mr-1" />Sources:</span>
                      {msg.citations.map((c, i) => (
                        <span key={i} className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded-md font-mono">{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Quick Preset Prompt Buttons at start */}
          {messages.length === 1 && (
            <div className="flex flex-wrap gap-2 pl-11 pt-2">
              <button 
                onClick={() => setInputQuery('Summarize the main points of my uploaded documents.')} 
                className="text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 px-3 py-1.5 rounded-xl transition flex items-center space-x-1.5"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Summarize documents</span>
              </button>
              <button 
                onClick={() => setInputQuery('Explain key technical concepts like I am a beginner.')} 
                className="text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 px-3 py-1.5 rounded-xl transition flex items-center space-x-1.5"
              >
                <GraduationCap className="w-3.5 h-3.5 text-indigo-400" />
                <span>Explain like a beginner</span>
              </button>
            </div>
          )}

        </div>

        {/* Chat Input Footer Bar */}
        <div className="p-4 md:p-6 border-t border-slate-800 bg-slate-900/40 backdrop-blur-md">
          <div className="max-w-4xl mx-auto">
            <form onSubmit={handleUserSubmit} className="relative flex items-center">
              <textarea 
                rows="1" 
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleUserSubmit(e);
                  }
                }}
                placeholder="Ask a question or request an explanation from your notes..." 
                className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-2xl pl-4 pr-16 py-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none max-h-32 shadow-inner"
              />
              
              <div className="absolute right-2.5 flex items-center space-x-1.5">
                <button 
                  type="submit" 
                  disabled={isGenerating || !inputQuery.trim()} 
                  className="bg-indigo-600 hover:bg-indigo-500 text-white w-9 h-9 rounded-xl flex items-center justify-center transition shadow-lg shadow-indigo-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
            <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-slate-500">
              <span>Tip: Press Shift + Enter for new line</span>
              <span>Powered by Vector Search & Server-Sent Events</span>
            </div>
          </div>
        </div>

      </main>

      {/* Notification Toast Element */}
      {toast.show && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border border-slate-800 px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-3 text-sm animate-bounce">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
            toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 
            toast.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-indigo-500/20 text-indigo-400'
          }`}>
            {toast.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : 
             toast.type === 'error' ? <AlertTriangle className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
          </div>
          <span className="text-slate-200">{toast.message}</span>
        </div>
      )}

    </div>
  );
}