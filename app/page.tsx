"use client";
import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: { text: string; score: number }[];
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileStatus, setFileStatus] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 上传文件
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileStatus("上传中...");
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();

    if (data.success) {
      setFileStatus(`✅ ${file.name} 已上传，共 ${data.chunksCount} 个片段`);
    } else {
      setFileStatus(`❌ 上传失败: ${data.error}`);
    }
  };

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: "user", content: input };
    const newMessages = [...messages, userMessage];
    const history = messages.slice(-6); // 最近3轮（user+assistant）
    setMessages([
      ...newMessages,
      { role: "assistant" as const, content: "", sources: [] },
    ]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input, history }),
      });
      if (!res.ok) {
        // 后端返回了非流的错误 JSON（比如 502），直接显示错误信息
        const errJson = await res.json().catch(() => null);
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            ...next[next.length - 1],
            content: `⚠️ 请求失败: ${errJson?.error || res.statusText}`,
          };
          return next;
        });
        setLoading(false);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = ""; // 用来拼“可能被切成两半的行”
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 按 SSE 的行规则拆：以 \n\n 或 \n 做切分（简易稳健版）
        const parts = buffer.split("\n");
        // 最后一段可能是不完整的行，留到下一轮
        buffer = parts.pop() || "";

        for (const line of parts) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data:")) continue;

          const jsonStr = trimmed.slice(5).trimStart(); // 去掉 "data:"
          try {
            const obj = JSON.parse(jsonStr);

            if (obj.type === "sources") {
              console.log(obj.sources);
              // 保存来源到对应的消息索引
              setMessages((prev) => {
                const next = [...prev];
                const lastIndex = next.length - 1;
                next[lastIndex] = { ...next[lastIndex], sources: obj.sources };
                return next;
              });
            } else {
              const obj = JSON.parse(jsonStr);
              const delta = obj?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) {
                // 3. 追加到占位 assistant 消息
                setMessages((prev) => {
                  const next = [...prev];
                  next[next.length - 1] = {
                    ...next[next.length - 1],
                    content: next[next.length - 1].content + delta,
                  };
                  return next;
                });
              }
            }
          } catch {
            // 偶尔会有心跳 ":" 或畸形行，忽略即可
          }
        }
      }
      // const assistantMessage: Message = {
      //   role: "assistant",
      //   content: data.reply || data.error || "出错了",
      // };
      // setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: `⚠️ 网络错误: ${err instanceof Error ? err.message : String(err)}`,
        };
        return next;
      });
    }

    setLoading(false);
  };

  return (
    <main className="flex flex-col h-screen max-w-3xl mx-auto p-4">
      {/* 标题 */}
      <h1 className="text-2xl font-bold text-center mb-4">📄 文档问答助手</h1>

      {/* 上传区域 */}
      <div className="mb-4 p-4 border rounded-lg bg-gray-50">
        <label className="block mb-2 text-sm font-medium">
          上传文档（PDF/DOCX）：
        </label>
        <input
          type="file"
          accept=".pdf,.docx"
          onChange={handleUpload}
          className="block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-md file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100"
        />
        {fileStatus && (
          <p className="mt-2 text-sm text-gray-600">{fileStatus}</p>
        )}
      </div>

      {/* 聊天记录 */}
      <div className="flex-1 overflow-y-auto mb-4 space-y-4 p-4 border rounded-lg">
        {messages.length === 0 && (
          <p className="text-center text-gray-400 mt-8">
            上传文档后，开始提问吧！
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              {msg.content}
            </div>
            {/* 如果是 assistant 消息且有来源，显示折叠区域 */}
            {msg.role === "assistant" &&
              msg.sources &&
              msg.sources.length > 0 && (
                <div>
                  <details>
                    <summary>📎 查看来源 ({msg.sources.length} 个)</summary>
                    {msg.sources.map((src, j) => (
                      <div key={j} className="mt-1 p-1 bg-gray-200 rounded">
                        <div className="line-clamp-3">{src.text}</div>
                        <div className="text-right">
                          相似度: {(src.score * 100).toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </details>
                </div>
              )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 p-3 rounded-lg text-gray-500">
              思考中...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="输入你的问题..."
          className="flex-1 p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          发送
        </button>
      </div>
    </main>
  );
}
