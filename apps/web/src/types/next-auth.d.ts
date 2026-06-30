import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    githubId: string;
    githubLogin: string;
  }

  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      githubLogin: string;
    };
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    githubId: string;
    githubLogin: string;
  }
}
