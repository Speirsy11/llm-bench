export function DashboardPoller({ active }: { readonly active: boolean }) {
  return active ? <meta httpEquiv="refresh" content="5" /> : null;
}
