"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface LoginContextType {
  isLoginModalOpen: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
}

const LoginContext = createContext<LoginContextType | undefined>(undefined);

export function LoginProvider({ children }: { children: ReactNode }) {
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const openLoginModal = () => setIsLoginModalOpen(true);
  const closeLoginModal = () => setIsLoginModalOpen(false);

  return (
    <LoginContext.Provider value={{ isLoginModalOpen, openLoginModal, closeLoginModal }}>
      {children}
    </LoginContext.Provider>
  );
}

export function useLoginModal() {
  const context = useContext(LoginContext);
  if (!context) {
    throw new Error("useLoginModal must be used within LoginProvider");
  }
  return context;
}
