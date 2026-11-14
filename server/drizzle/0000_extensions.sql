-- pgvector for embeddings, pg_trgm for Chinese keyword search (ADR-0001).
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
