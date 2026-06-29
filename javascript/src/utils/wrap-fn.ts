/**
 * Wrap a function with correct, unminified parameter names for hypha-rpc.
 *
 * In production builds, Babel/Terser minifies parameter names (e.g. 'code' → 'e').
 * hypha-rpc's getFunctionInfo() parses Function.toString() to map kwargs to
 * positional args. With minified names, kwargs like {code: '...'} can't be
 * mapped and args are silently dropped.
 *
 * CSP NOTE: this used to build the wrapper with `new Function(...)`, but that is
 * blocked on pages whose Content Security Policy lacks `'unsafe-eval'` (the exact
 * pages the bookmarklet targets). Instead we use a normal closure and OVERRIDE its
 * `.toString()` so hypha-rpc still reads the real, unminified parameter names from
 * the schema — no eval / Function constructor involved.
 *
 * Additionally, it handles the case where hypha-rpc passes kwargs as a single
 * object argument (e.g. `fn({url: "..."})` instead of `fn("...")`). The
 * wrapper detects this and destructures the kwargs object automatically.
 */
export function wrapFn(fn: any): any {
  const schema = fn.__schema__;
  const paramNames: string[] = schema?.parameters?.properties
    ? Object.keys(schema.parameters.properties)
    : [];

  if (paramNames.length === 0) {
    return fn;
  }

  // A plain closure (no new Function). It:
  // 1. Detects kwargs passed as a single object and destructures them.
  //    hypha-rpc's HTTP handler passes kwargs as one plain object, e.g.
  //    execute_script({code: "..."}) instead of execute_script("..."),
  //    get_react_tree({}) instead of get_react_tree().
  // 2. Otherwise forwards positional args unchanged.
  const wrapper = async function (...args: any[]): Promise<any> {
    if (
      args.length === 1 &&
      args[0] != null &&
      typeof args[0] === "object" &&
      !Array.isArray(args[0]) &&
      !(args[0] instanceof Date) &&
      // Plain-object check that is realm-agnostic (kwargs may be created in a
      // different realm — e.g. hypha-rpc's HTTP handler, or relayed across a
      // postMessage/extension boundary). `constructor === Object` fails across
      // realms, so also accept the constructor name and a null prototype.
      isPlainObject(args[0])
    ) {
      const kw = args[0];
      const keys = Object.keys(kw);
      // Empty object {} → call with no args (all defaults)
      if (keys.length === 0) {
        return fn();
      }
      // Keys match schema params → destructure into positional args
      if (paramNames.indexOf(keys[0]) !== -1) {
        return fn.apply(null, paramNames.map((n) => kw[n]));
      }
    }
    return fn.apply(null, args);
  };

  // hypha-rpc's getFunctionInfo() does `func.toString()` and extracts the param
  // names from the first `(...)`. A real `...args` wrapper would hide them, so
  // expose the schema's names via a toString override (CSP-safe, unlike Function).
  const fakeSource = `function (${paramNames.join(", ")}) {}`;
  try {
    Object.defineProperty(wrapper, "toString", {
      value: () => fakeSource,
      writable: true,
      configurable: true,
    });
    // Some consumers read arity via Function.length — keep it consistent.
    Object.defineProperty(wrapper, "length", {
      value: paramNames.length,
      configurable: true,
    });
  } catch {
    (wrapper as any).toString = () => fakeSource;
  }

  if (schema) (wrapper as any).__schema__ = schema;
  return wrapper;
}

/** Realm-agnostic "is this a plain object (kwargs bag)?" check. */
function isPlainObject(x: any): boolean {
  const proto = Object.getPrototypeOf(x);
  return (
    proto === null ||
    proto === Object.prototype ||
    proto?.constructor?.name === "Object"
  );
}
