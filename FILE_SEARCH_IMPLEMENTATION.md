# OpenAI file_search Tool Integration

## Overview

This document describes the hybrid file reading approach implemented for handling document attachments in the chat application. The system now combines:

1. **Inline Previews**: Server-side extraction of document content (up to 32KB for office docs, 16KB for text)
2. **OpenAI file_search**: Semantic search capability for large files (>100KB) using vector embeddings

## Architecture

### File Processing Pipeline

When a user attaches files to a message:

1. **Size Detection**: Server checks file size via HEAD request
2. **Large File Upload**: Files >100KB are uploaded to OpenAI File API with purpose "assistants"
3. **Vector Store Creation**: Uploaded file IDs are added to a conversation-specific vector store
4. **Preview Extraction**: ALL files get inline text extraction regardless of size
5. **Message Enhancement**: Both preview and file_search capability are provided to the model

### Supported File Types

#### Comprehensive Extraction (Server-side)
- **PDF**: Uses `pdf-parse` library, extracts up to 32KB of text
- **DOCX**: Uses `mammoth` library for raw text extraction (32KB limit)
- **PPTX**: Uses `jszip` to parse XML slides, first 20 slides
- **XLSX**: Uses `xlsx` library, first 5 sheets × 50 rows as CSV
- **ZIP**: Lists first 100 files in archive
- **Text-like**: CSV, JSON, Markdown, code files (16KB limit)

#### file_search Enabled (OpenAI)
Any file >100KB is automatically uploaded for semantic search, supporting:
- Large PDFs, Word documents, PowerPoint presentations
- Spreadsheets, archives, and other binary formats
- Full-text semantic queries: "find pricing section", "extract all dates", "summarize chapter 3"

## Implementation Details

### Backend Changes (`new-client/app/api/chat/route.ts`)

#### File Upload Logic
```typescript
// Check file size
const headRes = await fetch(att.url, { method: "HEAD" });
const contentLength = headRes.headers.get("content-length");
const fileSize = contentLength ? parseInt(contentLength, 10) : 0;

// Upload large files to OpenAI
if (fileSize > 100 * 1024) {
  const fileRes = await fetch(att.url);
  const fileBlob = await fileRes.blob();
  const file = new File([fileBlob], att.name || "file", { 
    type: att.mime || "application/octet-stream" 
  });
  
  const uploadedFile = await openai.files.create({
    file: file,
    purpose: "assistants",
  });
  
  openaiFileIds.push(uploadedFile.id);
}
```

#### Vector Store Creation
```typescript
// Create vector store with all uploaded files
const vectorStore = await openai.beta.vectorStores.create({
  name: `conversation-${conversationId}-${Date.now()}`,
  file_ids: openaiFileIds,
});
```

#### Tool Configuration
```typescript
// Enable file_search tool when vector store exists
const fileSearchTool = { 
  type: "file_search" as const, 
  ...(vectorStoreId ? { vector_store_ids: [vectorStoreId] } : {}) 
};

// Add to tools array
if (vectorStoreId) {
  toolsForRequest.push(fileSearchTool as Tool);
}

// Request file_search results in stream
const includeFields = [];
if (allowWebSearch) {
  includeFields.push("web_search_call.results", "web_search_call.action.sources");
}
if (vectorStoreId) {
  includeFields.push("file_search_call.results");
}
```

#### Truncation Indicators
Previews for large files include a note:
```
[Attachment preview: document.pdf [Preview truncated; full content searchable via file_search tool]]
```

### Frontend Changes

#### Status Event Types (`new-client/components/chat/chat-page-shell.tsx`)
```typescript
type SearchStatusEvent =
  | { type: "file-search-start"; query: string }
  | { type: "file-search-complete"; query: string }
  // ... other event types
```

#### Event Handling
```typescript
case "file-search-start":
  showFileReadingIndicator("running");
  break;
case "file-search-complete":
  clearFileReadingIndicator();
  break;
```

### System Prompt Enhancement

Model instructions now mention file_search capability:
```
- If an attachment preview is marked as '[Preview truncated; full content searchable via file_search tool]', 
  you can use the `file_search` tool to query specific information from the full document 
  (e.g., 'find pricing section', 'extract all dates', 'summarize chapter 3').
```

## Benefits

### Hybrid Approach Advantages

1. **Immediate Context**: Inline previews give the model instant access to document content without tool calls
2. **Semantic Search**: Large documents can be queried efficiently ("find all mentions of X")
3. **Cost Efficiency**: Small files use free extraction; large files leverage OpenAI's optimized infrastructure
4. **User Experience**: No interruption in flow; model decides when to use file_search vs inline preview

### Use Cases

#### Inline Preview Sufficient
- Small documents (<100KB)
- Simple summarization requests
- When entire content fits in context window

#### file_search Tool Invoked
- Large multi-page documents
- Targeted queries: "What's the pricing in section 5?"
- Multi-document search: "Compare references across all PDFs"
- When model needs specific sections from large files

## Limitations & Future Improvements

### Current Limitations
1. Vector stores are created per-conversation, not persisted across sessions
2. No OCR for images (planned: tesseract.js)
3. No audio/video transcription (planned: Whisper API)
4. Binary formats without text structure may extract poorly

### Planned Enhancements
1. **Persistence**: Store OpenAI file IDs and vector store IDs in Supabase for reuse
2. **OCR**: Add image text extraction using tesseract.js
3. **Transcription**: Audio/video support via OpenAI Whisper API
4. **Cleanup**: Schedule vector store deletion after conversation age threshold
5. **Cost Tracking**: Monitor OpenAI file storage and vector store costs

## Dependencies

### NPM Packages
```json
{
  "pdf-parse": "^1.1.1",
  "mammoth": "^1.8.0", 
  "xlsx": "^0.18.5",
  "jszip": "^3.10.1",
  "openai": "^4.73.0"
}
```

### Environment Variables
```
OPENAI_API_KEY=sk-...
```

## Testing

### Manual Test Cases

1. **Small PDF (<100KB)**
   - Upload → Check inline preview in message → Model responds using preview
   - Expected: No file_search tool called, instant response

2. **Large PDF (>100KB)**
   - Upload → Check "[Preview truncated...]" note → Ask "What's in section 3?"
   - Expected: file_search tool called, targeted content retrieved

3. **Multiple Files**
   - Upload 3 documents → Ask "Compare findings across all documents"
   - Expected: Multiple file_search queries, synthesized answer

4. **Office Documents**
   - Upload DOCX, XLSX, PPTX → Check extraction quality
   - Expected: Tables formatted as CSV, slides as text, clean extraction

## Conclusion

This hybrid approach provides production-grade file reading capabilities comparable to ChatGPT and Claude, balancing immediate access to content with powerful semantic search for large documents. The system scales from small text files to multi-hundred-page PDFs without sacrificing user experience or model capability.
