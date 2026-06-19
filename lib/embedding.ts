// 修改点 1：导入方式不变，但换 baseURL
import OpenAI from 'openai';

const deepseek = new OpenAI({
  apiKey: process.env.SILICONFLOW_API_KEY,
  baseURL: 'https://api.siliconflow.cn/v1',
});

/**
 * 为单个文本生成向量
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const response = await deepseek.embeddings.create({
    model: 'BAAI/bge-m3',          // 修改点 4：模型名
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * 批量生成向量
 */
export async function getEmbeddingsBatch(
  texts: string[],
  batchSize = 10
): Promise<number[][]> {
  const results: number[][] = [];
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    console.log(`正在处理第 ${i + 1}~${Math.min(i + batchSize, texts.length)} 块...`);
    
    const response = await deepseek.embeddings.create({
      model: 'BAAI/bge-m3',
      input: batch,
    });
    
    const embeddings = response.data.map(d => d.embedding);
    results.push(...embeddings);
  }
  
  return results;
}