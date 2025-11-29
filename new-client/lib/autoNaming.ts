export interface AutoNamingResponse {
  title?: string;
}

export async function requestAutoNaming(
  conversationId: string,
  userMessage: string,
  onTitleUpdate?: (partialTitle: string) => void
): Promise<AutoNamingResponse | null> {
  try {
    const response = await fetch("/api/conversations/generate-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        userMessage,
      }),
    });

    if (!response.ok) {
      console.error(
        "Auto-naming API returned error:",
        response.status,
        response.statusText
      );
      return null;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      console.error("No response body reader for title stream");
      return null;
    }

    const decoder = new TextDecoder();
    let finalTitle: string | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((l) => l.trim());

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);

            if (parsed.token && parsed.fullTitle && onTitleUpdate) {
              // Stream each token to update the UI
              onTitleUpdate(parsed.fullTitle);
            }

            if (parsed.done && parsed.title) {
              finalTitle = parsed.title;
            }

            if (parsed.error) {
              console.error("Title generation error:", parsed.error);
              return null;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { title: finalTitle };
  } catch (error) {
    console.error("Auto-naming request failed:", error);
    return null;
  }
}
