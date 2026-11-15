/**
 * @corsj/dsh — React 最小类型声明（DSH 客户端运行时提供 react，构建期不作为依赖）。
 */
declare module 'react' {
  export interface ReactElement {
    type: unknown;
    props: Record<string, unknown>;
    key: unknown;
  }
  export function createElement(
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): ReactElement;
  export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
  export function useState<T>(init: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  const React: {
    createElement: typeof createElement;
    useEffect: typeof useEffect;
    useState: typeof useState;
  };
  export default React;
}
