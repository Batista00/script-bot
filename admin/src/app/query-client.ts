import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

export function businessQueryKey(
  resource: string,
  businessId: string,
  ...parts: readonly unknown[]
): readonly unknown[] {
  return [resource, businessId, ...parts] as const;
}

export function purgeBusinessCache(client: QueryClient, businessId: string): void {
  client.removeQueries({
    predicate: (query) => query.queryKey[1] === businessId,
  });
}
