"use client";

import { useEffect, useState, useRef } from "react";

interface AnimatedTitleProps {
  title: string;
  className?: string;
  chatId: string;
}

// Track which chats have already been animated
const animatedChats = new Set<string>();

export function AnimatedTitle({ title, className, chatId }: AnimatedTitleProps) {
  const [displayedTitle, setDisplayedTitle] = useState(title);
  const hasAnimated = useRef(animatedChats.has(chatId));
  const mountedTitleRef = useRef(title);

  useEffect(() => {
    // If already animated this chat, just show the title immediately
    if (hasAnimated.current) {
      setDisplayedTitle(title);
      return;
    }

    // If this is the initial mount with the same title, don't animate (page load/refresh)
    if (mountedTitleRef.current === title) {
      setDisplayedTitle(title);
      hasAnimated.current = true;
      animatedChats.add(chatId);
      return;
    }

    // Title changed after mount - this is a model rename, animate it
    const words = title.split(" ");
    let currentIndex = 0;
    setDisplayedTitle("");

    const interval = setInterval(() => {
      if (currentIndex < words.length) {
        setDisplayedTitle((prev) => {
          const newText = prev ? `${prev} ${words[currentIndex]}` : words[currentIndex];
          return newText;
        });
        currentIndex++;
      } else {
        clearInterval(interval);
        hasAnimated.current = true;
        animatedChats.add(chatId);
      }
    }, 150);

    return () => clearInterval(interval);
  }, [title, chatId]);

  return <span className={`${className} block w-full`}>{displayedTitle}</span>;
}
