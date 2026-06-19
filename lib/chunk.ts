/**
 * 文本分块函数
 * 策略：按段落优先，段落过长时按句子切分，尽量保持语义完整
 */
export interface ChunkResult {
    id: string;      // 块唯一标识，如 "chunk-0", "chunk-1"
    text: string;    // 块文本内容
    index: number;   // 块在原文档中的顺序
  }
  
  export function splitTextIntoChunks(text: string, maxChunkSize = 500): ChunkResult[] {
    // 1. 按换行符分割成段落，过滤掉空段落
    const paragraphs = text.split(/\n+/).filter(p => p.trim().length > 0);
    
    const chunks: ChunkResult[] = [];
    let currentChunk = '';
    let chunkIndex = 0;
  
    for (const paragraph of paragraphs) {
      // 情况1：段落本身超过最大长度 → 需要按句子进一步切分
      if (paragraph.length > maxChunkSize) {
        // 先把当前累积的 chunk 存起来（如果有的话）
        if (currentChunk.trim()) {
          chunks.push({
            id: `chunk-${chunkIndex}`,
            text: currentChunk.trim(),
            index: chunkIndex++,
          });
          currentChunk = '';
        }
        
        // 按句子切分长段落（中文句号、问号、感叹号、分号作为句子边界）
        const sentences = paragraph.split(/[。！？；]/).filter(s => s.trim());
        for (const sentence of sentences) {
          // 如果当前句子加上去会超出最大长度，先把当前块存起来
          if ((currentChunk + sentence).length > maxChunkSize) {
            if (currentChunk.trim()) {
              chunks.push({
                id: `chunk-${chunkIndex}`,
                text: currentChunk.trim(),
                index: chunkIndex++,
              });
            }
            currentChunk = sentence + '。';
          } else {
            currentChunk += sentence + '。';
          }
        }
      } 
      // 情况2：段落正常大小 → 累积到当前块
      else {
        // 如果当前块加上这个段落会超出最大长度，先把当前块存起来
        if ((currentChunk + paragraph).length > maxChunkSize) {
          chunks.push({
            id: `chunk-${chunkIndex}`,
            text: currentChunk.trim(),
            index: chunkIndex++,
          });
          currentChunk = paragraph + '\n';
        } else {
          currentChunk += paragraph + '\n';
        }
      }
    }
  
    // 处理最后一块
    if (currentChunk.trim()) {
      chunks.push({
        id: `chunk-${chunkIndex}`,
        text: currentChunk.trim(),
        index: chunkIndex,
      });
    }
  
    return chunks;
  }