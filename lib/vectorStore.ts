import { getEmbedding, getEmbeddingsBatch } from './embedding';
import { ChunkResult } from './chunk';

// 向量库中的一条记录
interface VectorRecord {
  id: string;                    // 块 ID
  text: string;                  // 原始文本
  vector: number[];              // 向量
  metadata?: Record<string, unknown>; // 附加信息（来源文件名、块序号等）
}

class InMemoryVectorStore {
  // 所有记录存储在内存数组中
  private records: VectorRecord[] = [];

  /**
   * 添加文档块到向量库
   * 自动完成：分块文本 → 向量化 → 存储
   */
  async addChunks(chunks: ChunkResult[], source?: string): Promise<void> {
    // 1. 提取所有文本
    const texts = chunks.map(c => c.text);
    
    // 2. 批量生成向量
    console.log(`开始向量化 ${chunks.length} 个文本块...`);
    const vectors = await getEmbeddingsBatch(texts);
    
    // 3. 存储到内存
    chunks.forEach((chunk, i) => {
      this.records.push({
        id: chunk.id,
        text: chunk.text,
        vector: vectors[i],
        metadata: { source, index: chunk.index },
      });
    });
    
    console.log(`✅ 向量库已添加 ${chunks.length} 条记录，总计 ${this.records.length} 条`);
  }

  /**
   * 计算两个向量的余弦相似度
   * 值越接近 1 表示越相似
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    // 计算点积
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    // 计算向量 A 的长度
    const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    // 计算向量 B 的长度
    const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    // 余弦相似度 = 点积 / (|A| × |B|)
    return dotProduct / (normA * normB);
  }

  /**
   * 相似度搜索
   * @param query 用户问题
   * @param topK 返回最相似的几条结果，默认 3
   * @returns 包含文本和相似度分数的数组
   */
  async search(query: string, topK = 3): Promise<{ text: string; score: number }[]> {
    if (this.records.length === 0) {
      console.log('⚠️ 向量库为空，请先上传文档');
      return [];
    }
    
    // 1. 把用户问题也转成向量
    console.log('正在向量化用户问题...');
    const queryVector = await getEmbedding(query);
    
    // 2. 计算与所有记录的相似度
    const scored = this.records.map(record => ({
      text: record.text,
      score: this.cosineSimilarity(queryVector, record.vector),
    }));
    
    // 3. 按相似度从高到低排序，取 Top-K
    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    
    console.log(`搜索完成，找到 ${results.length} 条相关结果`);
    results.forEach((r, i) => {
      console.log(`  结果 ${i + 1}: 相似度 ${r.score.toFixed(4)}`);
      console.log(`  内容预览: ${r.text.slice(0, 60)}...`);
    });
    
    return results;
  }

  /**
   * 获取向量库统计信息
   */
  stats(): { totalRecords: number; sources: string[] } {
    const sources = [
      ...new Set(
        this.records
          .map(r => r.metadata?.source)
          .filter(Boolean)
      )
    ] as string[];
    
    return {
      totalRecords: this.records.length,
      sources,
    };
  }
}

// 导出单例（整个应用共用一个向量库实例）
export const vectorStore = new InMemoryVectorStore();