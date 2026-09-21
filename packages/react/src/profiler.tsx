import {
  Profiler as ReactProfiler,
  type ComponentType,
  type ProfilerOnRenderCallback,
  type ReactNode,
} from 'react';
import { Talaria } from '@newtalaria/browser';

export interface ProfilerProps {
  id: string;
  children: ReactNode;
}

/**
 * Record React commit duration as a child span when tracing is on.
 */
export function Profiler({ id, children }: ProfilerProps): ReactNode {
  const onRender: ProfilerOnRenderCallback = (
    profileId,
    _phase,
    actualDuration,
  ) => {
    const span = Talaria.startInactiveSpan(`ui.react.${profileId}`, {
      kind: 'internal',
      attributes: {
        'ui.component_name': profileId,
        'ui.render.duration_ms': actualDuration,
      },
    });
    span?.end();
  };

  return (
    <ReactProfiler id={id} onRender={onRender}>
      {children}
    </ReactProfiler>
  );
}

export function withProfiler<P extends object>(
  Wrapped: ComponentType<P>,
  id?: string,
): (props: P) => ReactNode {
  const name = id || Wrapped.displayName || Wrapped.name || 'Component';
  function Profiled(props: P) {
    return (
      <Profiler id={name}>
        <Wrapped {...props} />
      </Profiler>
    );
  }
  Profiled.displayName = `withProfiler(${name})`;
  return Profiled;
}
