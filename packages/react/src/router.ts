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
  const initial = router.state?.location.pathname;
  if (initial) {
    Talaria.startNavigation({ name: initial });
  }
  return router.subscribe((state) => {
    const loc = state.location;
    Talaria.startNavigation({
      name: loc.pathname,
      url: `${loc.pathname}${loc.search ?? ''}${loc.hash ?? ''}`,
    });
  });
}
