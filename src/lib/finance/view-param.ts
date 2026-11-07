import type { View } from "./views";

/** URL value for a view: "everyone", "shared", or a member's id. */
export function viewParam(view: View): string {
  return view.kind === "person" ? view.personId : view.kind;
}

export function parseView(value: string | undefined, members: { id: string }[]): View {
  if (value === "shared") return { kind: "shared" };
  const member = members.find((candidate) => candidate.id === value);
  return member ? { kind: "person", personId: member.id } : { kind: "everyone" };
}

export function viewLabel(view: View, members: { id: string; name: string }[]): string {
  if (view.kind === "everyone") return "Everyone";
  if (view.kind === "shared") return "Shared";
  return members.find((member) => member.id === view.personId)?.name ?? "Unknown";
}

/** The transactions list filter that matches a view. */
export function viewPersonFilter(view: View): string | undefined {
  if (view.kind === "person") return view.personId;
  if (view.kind === "shared") return "household";
  return undefined;
}
