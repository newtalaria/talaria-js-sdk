import { Talaria } from '@newtalaria/browser';

export interface RouterLocation {
  pathname: string;
  search?: string;
  hash?: string;
}

export interface SubscribableRouter {
  subscribe(listener: (state: { location: RouterLocation }) => void): () => void;
  state?: { location: RouterLocation };
}

/**
 * Record React Router v6/v7 navigations as Talaria transactions.
 * Optional — `react-router` is a peer dependency.
 */
export function instrumentReactRouter(router: SubscribableRouter): () => void {
  // A Talaria fault never breaks routing (D19).
  const navigate = (opts: { name: string; url?: string }) => {
    try {
      Talaria.startNavigation(opts);
    } catch {
      /* ignore */
    }
  };
  const initial = router.state?.location.pathname;
  if (initial) {
    navigate({ name: initial });
  }
  return router.subscribe((state) => {
    const loc = state?.location;
    if (!loc) return;
    navigate({
      name: loc.pathname,
      url: `${loc.pathname}${loc.search ?? ''}${loc.hash ?? ''}`,
    });
  });
}
