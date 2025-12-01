"use client";

import { createContext, useContext } from "react";

export type UserIdentity = {
  userId: string | null;
  fullName: string | null;
  email: string | null;
  isGuest: boolean;
};

const UserIdentityContext = createContext<UserIdentity>({
  userId: null,
  fullName: null,
  email: null,
  isGuest: true,
});

export function UserIdentityProvider({
  identity,
  children,
}: {
  identity: UserIdentity;
  children: React.ReactNode;
}) {
  return (
    <UserIdentityContext.Provider value={identity}>
      {children}
    </UserIdentityContext.Provider>
  );
}

export function useUserIdentity() {
  return useContext(UserIdentityContext);
}
