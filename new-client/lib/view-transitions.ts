"use client";

type NavigateFn = () => void;
type RouterLike = { push: (href: string) => void; replace?: (href: string) => void };
type CrossfadeKind = "main" | "chat";

function prefersReducedMotion() {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

const CROSSFADE_MAIN_TOKEN_KEY = "llm-client-crossfade-main-token";
const CROSSFADE_CHAT_TOKEN_KEY = "llm-client-crossfade-chat-token";
const CROSSFADE_EVENT_NAME = "llm-client-crossfade-start";

function tokenKeyForKind(kind: CrossfadeKind) {
  return kind === "main" ? CROSSFADE_MAIN_TOKEN_KEY : CROSSFADE_CHAT_TOKEN_KEY;
}

function emitCrossfadeStart(kind: CrossfadeKind) {
  if (typeof window === "undefined") return;
  let token: string | null = null;
  try {
    token = window.sessionStorage.getItem(tokenKeyForKind(kind));
    if (token) window.sessionStorage.removeItem(tokenKeyForKind(kind));
  } catch {
    token = null;
  }
  if (!token) return;

  window.dispatchEvent(
    new CustomEvent(CROSSFADE_EVENT_NAME, {
      detail: { kind, token },
    })
  );
}

function createCrossfadeOverlay(sourceEl: HTMLElement, overlayKind: CrossfadeKind) {
  if (typeof document === "undefined") return;

  const rect = sourceEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const syncScrollPositions = (sourceRoot: HTMLElement, cloneRoot: HTMLElement) => {
    try {
      const sourceViewports = Array.from(
        sourceRoot.querySelectorAll<HTMLElement>('[data-slot="scroll-area-viewport"]')
      );
      const cloneViewports = Array.from(
        cloneRoot.querySelectorAll<HTMLElement>('[data-slot="scroll-area-viewport"]')
      );
      const viewportCount = Math.min(sourceViewports.length, cloneViewports.length);
      for (let i = 0; i < viewportCount; i += 1) {
        const src = sourceViewports[i];
        const dst = cloneViewports[i];
        dst.style.scrollBehavior = "auto";
        dst.scrollTop = src.scrollTop;
        dst.scrollLeft = src.scrollLeft;
      }

      const sourceNodes = Array.from(sourceRoot.querySelectorAll<HTMLElement>("*"));
      const cloneNodes = Array.from(cloneRoot.querySelectorAll<HTMLElement>("*"));
      const count = Math.min(sourceNodes.length, cloneNodes.length);
      for (let i = 0; i < count; i += 1) {
        const src = sourceNodes[i];
        const dst = cloneNodes[i];
        if (src.scrollTop) dst.scrollTop = src.scrollTop;
        if (src.scrollLeft) dst.scrollLeft = src.scrollLeft;
      }
    } catch {
      // ignore
    }
  };

  const overlay = document.createElement("div");
  overlay.className =
    overlayKind === "main"
      ? "crossfade-overlay crossfade-overlay--main"
      : "crossfade-overlay crossfade-overlay--chat";

  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;

  const clone = sourceEl.cloneNode(true) as HTMLElement;
  clone.style.width = "100%";
  clone.style.height = "100%";
  clone.style.margin = "0";

  overlay.appendChild(clone);
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("data-crossfade-overlay", "true");
  overlay.setAttribute("data-crossfade-kind", overlayKind);

  document.body.appendChild(overlay);

  // Prevent the live DOM from flashing/jumping (e.g., scroll restoration) underneath the overlay.
  sourceEl.classList.add("crossfade-source-hidden");

  let fallbackTimer: number | null = null;
  let hardCleanupTimer: number | null = null;

  const cleanup = () => {
    if (fallbackTimer !== null) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (hardCleanupTimer !== null) {
      window.clearTimeout(hardCleanupTimer);
      hardCleanupTimer = null;
    }
    window.removeEventListener(CROSSFADE_EVENT_NAME, onCrossfadeStart);
    overlay.removeEventListener("transitionend", onTransitionEnd);
    if (sourceEl.isConnected) sourceEl.classList.remove("crossfade-source-hidden");
    if (overlay.isConnected) overlay.remove();
  };

  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== overlay) return;
    if (event.propertyName !== "opacity") return;
    cleanup();
  };

  overlay.addEventListener("transitionend", onTransitionEnd);

  const startFadeOut = () => {
    if (!overlay.isConnected) return;
    overlay.classList.add("crossfade-overlay-exit");
  };

  let overlayToken: string | null = null;
  try {
    overlayToken = window.sessionStorage.getItem(tokenKeyForKind(overlayKind));
  } catch {
    overlayToken = null;
  }

  const onCrossfadeStart = (event: Event) => {
    const custom = event as CustomEvent<{ kind?: CrossfadeKind; token?: string }>;
    if (!custom?.detail) return;
    if (custom.detail.kind !== overlayKind) return;
    if (!overlayToken || custom.detail.token !== overlayToken) return;
    window.removeEventListener(CROSSFADE_EVENT_NAME, onCrossfadeStart);
    startFadeOut();
  };

  if (overlayToken) {
    window.addEventListener(CROSSFADE_EVENT_NAME, onCrossfadeStart);
  }

  // Safety: if the destination never signals, fade out anyway.
  fallbackTimer = window.setTimeout(() => {
    startFadeOut();
  }, 900);

  hardCleanupTimer = window.setTimeout(cleanup, 1400);

  // Sync scroll after the clone is mounted so the overlay represents exactly what was on-screen.
  window.requestAnimationFrame(() => {
    syncScrollPositions(sourceEl, clone);
    window.requestAnimationFrame(() => syncScrollPositions(sourceEl, clone));
  });
}

const MAIN_PANEL_ANIMATE_NEXT_KEY = "llm-client-main-panel-animate-next";
const CHAT_BODY_ANIMATE_NEXT_KEY = "llm-client-chat-body-animate-next";

function markNextMainPanelEnterAnimation() {
  try {
    window.sessionStorage.setItem(MAIN_PANEL_ANIMATE_NEXT_KEY, "1");
  } catch {
    // ignore
  }
}

function markNextChatBodyEnterAnimation() {
  try {
    window.sessionStorage.setItem(CHAT_BODY_ANIMATE_NEXT_KEY, "1");
  } catch {
    // ignore
  }
}

export function runMainPanelEnterIfNeeded(mainPanelEl: HTMLElement | null) {
  if (!mainPanelEl || typeof window === "undefined") return;
  if (prefersReducedMotion()) return;

  let shouldAnimate = false;
  try {
    shouldAnimate =
      window.sessionStorage.getItem(MAIN_PANEL_ANIMATE_NEXT_KEY) === "1";
    window.sessionStorage.removeItem(MAIN_PANEL_ANIMATE_NEXT_KEY);
  } catch {
    shouldAnimate = false;
  }

  if (!shouldAnimate) return;

  mainPanelEl.classList.remove("main-panel-exit");
  mainPanelEl.classList.add("main-panel-enter");
  emitCrossfadeStart("main");
  window.setTimeout(() => {
    mainPanelEl.classList.remove("main-panel-enter");
  }, 260);
}

export function runChatBodyEnterIfNeeded(chatBodyEl: HTMLElement | null) {
  if (!chatBodyEl || typeof window === "undefined") return;
  if (prefersReducedMotion()) return;

  let shouldAnimate = false;
  try {
    shouldAnimate =
      window.sessionStorage.getItem(CHAT_BODY_ANIMATE_NEXT_KEY) === "1";
    window.sessionStorage.removeItem(CHAT_BODY_ANIMATE_NEXT_KEY);
  } catch {
    shouldAnimate = false;
  }

  if (!shouldAnimate) return;

  chatBodyEl.classList.remove("chat-body-exit");
  chatBodyEl.classList.add("chat-body-enter");
  emitCrossfadeStart("chat");
  window.setTimeout(() => {
    chatBodyEl.classList.remove("chat-body-enter");
  }, 260);
}

export function startMainPanelTransition(navigate: NavigateFn) {
  if (typeof document === "undefined" || prefersReducedMotion()) {
    navigate();
    return;
  }

  const anyDocument = document as any;
  if (typeof anyDocument.startViewTransition === "function") {
    anyDocument.startViewTransition(navigate);
    return;
  }

  navigate();
}

export function pushWithMainPanelTransition(
  router: RouterLike,
  href: string
) {
  startMainPanelTransition(() => router.push(href));
}

function doNavigate(router: RouterLike, href: string, mode: "push" | "replace") {
  if (mode === "replace" && typeof router.replace === "function") {
    router.replace(href);
    return;
  }
  router.push(href);
}

export async function navigateWithMainPanelFade(
  router: RouterLike,
  href: string,
  mode: "push" | "replace" = "push"
) {
  if (typeof document === "undefined" || prefersReducedMotion()) {
    doNavigate(router, href, mode);
    return;
  }

  markNextMainPanelEnterAnimation();

  const mainPanel = document.querySelector<HTMLElement>('[data-main-panel="true"]');
  if (mainPanel) {
    try {
      window.sessionStorage.setItem(tokenKeyForKind("main"), `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    } catch {
      // ignore
    }
    createCrossfadeOverlay(mainPanel, "main");
  }
  doNavigate(router, href, mode);
}

export async function navigateWithChatBodyFade(
  router: RouterLike,
  href: string,
  mode: "push" | "replace" = "push"
) {
  if (typeof document === "undefined" || prefersReducedMotion()) {
    doNavigate(router, href, mode);
    return;
  }

  markNextChatBodyEnterAnimation();

  const chatBody = document.querySelector<HTMLElement>('[data-chat-body="true"]');
  if (chatBody) {
    try {
      window.sessionStorage.setItem(tokenKeyForKind("chat"), `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    } catch {
      // ignore
    }
    createCrossfadeOverlay(chatBody, "chat");
  }
  doNavigate(router, href, mode);
}
