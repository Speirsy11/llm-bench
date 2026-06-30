import { parseWebEnv } from "@/env";
import { resolveRouteAccess } from "@/route-policy";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

import {
  createAuthAdapter,
  createDatabase,
  toAuthContext,
} from "@llm-bench/control-plane";

const env = parseWebEnv(process.env);
const database = createDatabase(env.databaseUrl);

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: createAuthAdapter(database.db),
  callbacks: {
    authorized({ auth: session, request }) {
      const actor = session?.user
        ? toAuthContext(
            {
              user: {
                id: session.user.id,
                githubLogin: session.user.githubLogin,
              },
            },
            env.adminGithubLogins,
          )
        : null;
      return (
        resolveRouteAccess(request.nextUrl.pathname, actor).kind === "allow"
      );
    },
    session({ session, user }) {
      session.user.id = user.id;
      session.user.githubLogin = user.githubLogin;
      return session;
    },
  },
  providers: [
    GitHub({
      clientId: env.githubClientId,
      clientSecret: env.githubClientSecret,
      profile(profile) {
        return {
          id: String(profile.id),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          githubId: String(profile.id),
          githubLogin: profile.login,
        };
      },
    }),
  ],
  secret: env.authSecret,
  session: { strategy: "database" },
});
