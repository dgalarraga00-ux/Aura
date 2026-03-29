// AUTO-GENERATED — do not edit manually
// Regenerate with: npx supabase gen types typescript --local > types/database.ts
// Schema version: 003_tables + 004_indexes + 005_rls + 006_triggers + 007_rpc + 008_handoffs + 009_onboarding

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  /** Required by @supabase/supabase-js ≥ 2.100 (PostgrestVersion discriminant) */
  PostgrestVersion: '12';
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string;
          name: string;
          slug: string;
          waba_id: string | null;
          phone_number_id: string | null;
          vault_secret_id: string | null;
          is_active: boolean;
          onboarding_completed: boolean;
          webhook_verify_token: string | null;
          bot_config: {
            system_prompt: string;
            handoff_keywords: string[];
            rag_score_threshold: number;
            language: string;
            max_tokens: number;
          };
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          waba_id?: string | null;
          phone_number_id?: string | null;
          vault_secret_id?: string | null;
          is_active?: boolean;
          onboarding_completed?: boolean;
          webhook_verify_token?: string | null;
          bot_config?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          waba_id?: string | null;
          phone_number_id?: string | null;
          vault_secret_id?: string | null;
          is_active?: boolean;
          onboarding_completed?: boolean;
          webhook_verify_token?: string | null;
          bot_config?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          tenant_id: string | null;
          role: 'saas_admin' | 'tenant_admin' | 'tenant_operator';
          full_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          tenant_id?: string | null;
          role: 'saas_admin' | 'tenant_admin' | 'tenant_operator';
          full_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          role?: 'saas_admin' | 'tenant_admin' | 'tenant_operator';
          full_name?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'users_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      contacts: {
        Row: {
          id: string;
          tenant_id: string;
          phone: string;
          name: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          phone: string;
          name?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          phone?: string;
          name?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'contacts_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          tenant_id: string;
          contact_id: string;
          is_escalated: boolean;
          escalated_at: string | null;
          escalation_trigger: Database['public']['Enums']['escalation_trigger_enum'] | null;
          resolved_at: string | null;
          resolved_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          contact_id: string;
          is_escalated?: boolean;
          escalated_at?: string | null;
          escalation_trigger?: Database['public']['Enums']['escalation_trigger_enum'] | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          contact_id?: string;
          is_escalated?: boolean;
          escalated_at?: string | null;
          escalation_trigger?: Database['public']['Enums']['escalation_trigger_enum'] | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversations_contact_id_fkey';
            columns: ['contact_id'];
            isOneToOne: false;
            referencedRelation: 'contacts';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          tenant_id: string;
          conversation_id: string;
          message_external_id: string;
          direction: Database['public']['Enums']['message_direction_enum'];
          message_type: Database['public']['Enums']['message_type_enum'];
          content: string | null;
          media_url: string | null;
          media_mime_type: string | null;
          llm_response: string | null;
          tool_calls: Json | null;
          rag_score: number | null;
          tokens_used: number | null;
          processing_ms: number | null;
          status: 'processing' | 'sent' | 'error' | 'unsupported';
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          conversation_id: string;
          message_external_id: string;
          direction: Database['public']['Enums']['message_direction_enum'];
          message_type: Database['public']['Enums']['message_type_enum'];
          content?: string | null;
          media_url?: string | null;
          media_mime_type?: string | null;
          llm_response?: string | null;
          tool_calls?: Json | null;
          rag_score?: number | null;
          tokens_used?: number | null;
          processing_ms?: number | null;
          status?: 'processing' | 'sent' | 'error' | 'unsupported';
          error?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          conversation_id?: string;
          message_external_id?: string;
          direction?: Database['public']['Enums']['message_direction_enum'];
          message_type?: Database['public']['Enums']['message_type_enum'];
          content?: string | null;
          media_url?: string | null;
          media_mime_type?: string | null;
          llm_response?: string | null;
          tool_calls?: Json | null;
          rag_score?: number | null;
          tokens_used?: number | null;
          processing_ms?: number | null;
          status?: 'processing' | 'sent' | 'error' | 'unsupported';
          error?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
        ];
      };
      knowledge_sources: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          source_type: 'pdf' | 'url' | 'csv' | 'text';
          storage_path: string | null;
          source_url: string | null;
          raw_text: string | null;
          chunk_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          source_type: 'pdf' | 'url' | 'csv' | 'text';
          storage_path?: string | null;
          source_url?: string | null;
          raw_text?: string | null;
          chunk_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          source_type?: 'pdf' | 'url' | 'csv' | 'text';
          storage_path?: string | null;
          source_url?: string | null;
          raw_text?: string | null;
          chunk_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_sources_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      knowledge_chunks: {
        Row: {
          id: string;
          tenant_id: string;
          source_id: string;
          chunk_index: number;
          content: string;
          embedding: number[] | null;
          metadata: Json;
          parent_chunk_id: string | null;
          chunk_type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          source_id: string;
          chunk_index: number;
          content: string;
          embedding?: number[] | null;
          metadata?: Json;
          parent_chunk_id?: string | null;
          chunk_type?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          source_id?: string;
          chunk_index?: number;
          content?: string;
          embedding?: number[] | null;
          metadata?: Json;
          parent_chunk_id?: string | null;
          chunk_type?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'knowledge_chunks_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'knowledge_chunks_source_id_fkey';
            columns: ['source_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_sources';
            referencedColumns: ['id'];
          },
        ];
      };
      ingestion_jobs: {
        Row: {
          id: string;
          tenant_id: string;
          source_id: string;
          status: Database['public']['Enums']['ingestion_status_enum'];
          error: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          source_id: string;
          status?: Database['public']['Enums']['ingestion_status_enum'];
          error?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          source_id?: string;
          status?: Database['public']['Enums']['ingestion_status_enum'];
          error?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ingestion_jobs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ingestion_jobs_source_id_fkey';
            columns: ['source_id'];
            isOneToOne: false;
            referencedRelation: 'knowledge_sources';
            referencedColumns: ['id'];
          },
        ];
      };
      handoffs: {
        Row: {
          id: string;
          conversation_id: string;
          tenant_id: string;
          trigger_type: 'keyword' | 'llm_tool' | 'rag_score';
          reason: string | null;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          tenant_id: string;
          trigger_type: 'keyword' | 'llm_tool' | 'rag_score';
          reason?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          tenant_id?: string;
          trigger_type?: 'keyword' | 'llm_tool' | 'rag_score';
          reason?: string | null;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'handoffs_conversation_id_fkey';
            columns: ['conversation_id'];
            isOneToOne: false;
            referencedRelation: 'conversations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'handoffs_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      auth_tenant_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      auth_role: {
        Args: Record<string, never>;
        Returns: string;
      };
      match_knowledge_chunks: {
        Args: {
          query_embedding: number[];
          match_tenant_id: string;
          match_count?: number;
          match_threshold?: number;
        };
        Returns: Array<{
          id: string;
          source_id: string;
          chunk_index: number;
          content: string;
          similarity: number;
        }>;
      };
      get_parent_chunk: {
        Args: {
          p_chunk_id: string;
          p_tenant_id: string;
        };
        Returns: Array<{
          id: string;
          content: string;
        }>;
      };
    };
    Enums: {
      message_type_enum: 'text' | 'audio' | 'image' | 'video' | 'document' | 'unknown';
      message_direction_enum: 'inbound' | 'outbound';
      escalation_trigger_enum: 'keyword' | 'llm_tool' | 'rag_score';
      ingestion_status_enum: 'pending' | 'processing' | 'completed' | 'failed';
    };
    CompositeTypes: Record<string, never>;
  };
};
