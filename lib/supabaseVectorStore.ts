import { supabase } from "./supabase";
import { Document } from '@langchain/core/documents';
import { getEmbedding, getEmbeddingsBatch } from './embedding';

type SearchResultRow = {
  content: string;
  metadata: Record<string, unknown>;
  score: number;
};

/**
 * 自定义 Supabase 向量存储，接口模仿 MemoryVectorStore
 */
class SupabaseVectorStore {
   private tableName = 'documents';
    private queryName = 'match_documents';

    getTableName(): string {
      return this.tableName;
    }
    /**
   * 添加文档（对应 MemoryVectorStore.addDocuments）
   */
    async addDocuments(docs: Document[]): Promise<void> {
      const texts = docs.map(doc => doc.pageContent);
      const metadata = docs.map(doc => doc.metadata || {});
      const vectors = await getEmbeddingsBatch(texts);
      
      const rows = vectors.map((_, i) => ({
        content: texts[i],
        embedding: vectors[i],
        metadata: {
          index: metadata[i].index,
          source: metadata[i].source,
        }
      }));

      
      // 分批插入（每批 20 条）
      for (let i = 0; i < rows.length; i += 20) {
        const batch = rows.slice(i, i + 20);
        const { error } = await supabase.from(this.tableName).insert(batch);
        if(error) {
          throw error;
        }
      }
    }
     /**
   * 相似度搜索并返回分数（对应 MemoryVectorStore.similaritySearchWithScore）
   */
    async similaritySearchWithScore(query: string, topK = 3): Promise<[Document, number][]> {
      const embedding = await getEmbedding(query);
      const { data, error } = await supabase.rpc(this.queryName, {
        query_embedding: embedding,
        match_count: topK,
        filter: {},
      });
      if(error) {
        throw error;
      }
      return (data || []).map((row: SearchResultRow) => [new Document({pageContent: row.content, metadata: row.metadata}), row.score]);
    } 

    /** 获取文档总数（用于 getStats） */
    async getTotalDocuments(): Promise<number> {
      const { count, error } = await supabase.from(this.tableName).select('*', { count: 'exact', head: true });
      if (error) {
        throw error;
      }
      return count ?? 0;
    }

}

export default  SupabaseVectorStore;