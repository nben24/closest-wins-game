import { SessionProvider } from "@/lib/client/session";

export default function GameLayout({ children }: LayoutProps<"/">) {
  return <SessionProvider>{children}</SessionProvider>;
}
