import { SHARED_SPENDING_MODE } from "@/lib/config";
import type { ViewOptions } from "./views";

/** How the household's money is divided between views (see views.ts). */
export function viewOptions(session: { members: { id: string }[] }): ViewOptions {
  return {
    memberCount: session.members.length,
    mode: SHARED_SPENDING_MODE,
    memberIds: session.members.map((member) => member.id),
  };
}
