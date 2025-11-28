export interface AutoNamingResponse {
  title?: string;
}

export async function requestAutoNaming(
  conversationId: string,
  userMessage: string
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

    const data = (await response.json()) as AutoNamingResponse;
    return data;
  } catch (error) {
    console.error("Auto-naming request failed:", error);
    return null;
  }
}
