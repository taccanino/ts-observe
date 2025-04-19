// ========================================================================
// 1. Core Wrapping Logic
// ========================================================================

export function observe<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  executeBefore: ((context: MiddlewareContext, ...args: TArgs) => TArgs)[] = [],
  executeAfter: ((context: MiddlewareContext, result: TReturn) => TReturn)[] = [],
  context?: MiddlewareContext
): (...args: TArgs) => TReturn {
  if (!context) {
    // Provide a default context if used standalone
    context = { kind: 'function', name: fn.name || 'anonymous', target: {} };
  }
  const ctxInfo = `[${context.kind}:${String(context.name)}]`;

  return function (this: any, ...args: TArgs): TReturn {
    let processedArgs = args;
    try {
      executeBefore.forEach((beforeFn) => {
        // Use .call() to pass 'this', 'context', and spread arguments correctly
        processedArgs = beforeFn.call(this, context, ...processedArgs);

        if (!Array.isArray(processedArgs)) {
          console.warn(`Before middleware for '${ctxInfo}' did not return array. Reverting.`, { middleware: beforeFn.name });
          processedArgs = args; // Keep original args if middleware failed
        }
      });
    } catch (e) {
      console.error(`Error during 'before' middleware for '${ctxInfo}':`, e);
      throw new Error(`Failed during 'before' middleware for '${ctxInfo}'`);
    }

    let result: TReturn;
    try {
      // Call the original function using apply to preserve 'this' and pass processed args
      result = fn.apply(this, processedArgs);
    } catch (e) {
      console.error(`Error during original execution for '${ctxInfo}':`, e);
      throw e; // Re-throw original error for better stack traces
    }

    try {
      executeAfter.forEach((afterFn) => {
        // .call() is correct here as MethodResultMiddleware expects (this, context, result)
        result = afterFn.call(this, context, result);
      });
    } catch (e) {
      console.error(`Error during 'after' middleware for '${ctxInfo}':`, e);
      throw new Error(`Failed during 'after' middleware for '${ctxInfo}'`);
    }

    return result;
  };
}

// ========================================================================
// 2. Middleware Type Definitions
// ========================================================================

// Base context structure passed to middleware
export interface MiddlewareContext {
  /** The kind of element being decorated ('function', 'method', 'getter', 'setter', 'class'). */
  kind: 'function' | 'method' | 'getter' | 'setter' | 'class';
  /** The name of the method, accessor, or class. */
  name: string | symbol;
  /** The target object (prototype for instance members, constructor for static members/class). */
  target: Function | Object;
  // Future context ideas: isStatic: boolean, descriptor?: PropertyDescriptor
}

// Middleware Type Definitions
export type MethodArgsMiddleware<TArgs extends any[]> = (this: any, context: MiddlewareContext, ...args: TArgs) => TArgs;
export type MethodResultMiddleware<TReturn> = (this: any, context: MiddlewareContext, result: TReturn) => TReturn;

export type ConstructorArgsMiddleware<TArgs extends any[]> = (this: null, context: MiddlewareContext, ...args: TArgs) => TArgs;
export type ConstructorInstanceMiddleware<TInstance> = (this: TInstance, context: MiddlewareContext, instance: TInstance) => TInstance | void;

export type AccessorGetArgMiddleware = (this: any, context: MiddlewareContext) => any; // BeforeGet specific
export type AccessorGetResultMiddleware<TReturn> = (this: any, context: MiddlewareContext, result: TReturn) => TReturn; // AfterGet specific
export type AccessorSetArgMiddleware<TVal> = (this: any, context: MiddlewareContext, value: TVal) => TVal; // BeforeSet specific
export type AccessorSetResultMiddleware = MethodResultMiddleware<void>; // AfterSet specific (setters return void)


// ========================================================================
// 3. Specific Decorator Factories
// ========================================================================

// 3.1. For Methods
export function ObserveMethod(config: {
  beforeArgs?: MethodArgsMiddleware<any[]>[],
  afterResult?: MethodResultMiddleware<any>[]
} = {}): MethodDecorator {
  const { beforeArgs = [], afterResult = [] } = config;

  return function (
    target: Object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor | void {
    const originalMethod = descriptor.value;
    if (typeof originalMethod === 'function') {
      const context: MiddlewareContext = {
        kind: 'method',
        name: propertyKey,
        target: target
      };
      descriptor.value = observe(originalMethod, beforeArgs, afterResult, context);
      return descriptor;
    } else {
      console.warn(`ObserveMethod applied to non-method property: ${String(propertyKey)}`);
    }
  };
}

// 3.2 For Accessors
export function ObserveAccessor(config: {
  beforeGet?: AccessorGetArgMiddleware[],
  afterGet?: AccessorGetResultMiddleware<any>[],
  beforeSet?: AccessorSetArgMiddleware<any>[],
  afterSet?: AccessorSetResultMiddleware[]
} = {}): MethodDecorator {
  const { beforeGet = [], afterGet = [], beforeSet = [], afterSet = [] } = config;

  return function (
    target: Object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor | void {

    const originalGetter = descriptor.get;
    const originalSetter = descriptor.set;
    let newGetter = originalGetter;
    let newSetter = originalSetter;
    let changed = false;

    // Wrap Getter
    if (typeof originalGetter === 'function') {
      const getterContext: MiddlewareContext = { kind: 'getter', name: propertyKey, target: target };
      // Getters have no 'beforeArgs' middleware, pass empty array
      newGetter = observe(originalGetter, beforeGet, afterGet, getterContext);
      changed = true;
    }

    // Wrap Setter
    if (typeof originalSetter === 'function') {
      const setterContext: MiddlewareContext = { kind: 'setter', name: propertyKey, target: target };

      // Adapt beforeSet middleware (which expect a single value)
      // to the MethodArgsMiddleware signature (which expect ...args)
      const adaptedBeforeSet = beforeSet.map(middleware => {
        const adapter: MethodArgsMiddleware<[any]> = function (this: any, ctx: MiddlewareContext, ...args: [any]): [any] {
          const originalValue = args[0];
          const processedValue = middleware.call(this, ctx, originalValue);
          return [processedValue];
        };
        return adapter;
      });

      // Pass the adapted middleware to observe
      newSetter = observe(originalSetter, adaptedBeforeSet, afterSet, setterContext);
      changed = true;
    }

    // Assign back to descriptor if changed
    if (changed) {
      descriptor.get = newGetter;
      descriptor.set = newSetter;
      return descriptor;
    } else {
      console.warn(`ObserveAccessor applied to non-accessor property: ${String(propertyKey)}`);
    }
  };
}


// 3.3. For Classes (Constructors)
export function ObserveClass(config: {
  beforeArgs?: ConstructorArgsMiddleware<any[]>[],
  afterInstance?: ConstructorInstanceMiddleware<any>[]
} = {}): ClassDecorator {
  const { beforeArgs = [], afterInstance = [] } = config;

  return function <TFunction extends Function>(
    OriginalConstructor: TFunction
  ): TFunction | void {

    if (typeof OriginalConstructor !== 'function' || !OriginalConstructor.prototype) {
      console.warn(`ObserveClass applied to non-class target.`);
      return OriginalConstructor;
    }

    const classContext: MiddlewareContext = {
      kind: 'class',
      name: OriginalConstructor.name,
      target: OriginalConstructor
    };

    // Define the new class extending the original
    const NewConstructor = class extends (OriginalConstructor as any) {
      constructor(...args: any[]) {
        let processedArgs = args;
        // Process beforeArgs (BEFORE super call)
        try {
          beforeArgs.forEach(middleware => {
            // Use apply for ConstructorArgsMiddleware (this is null)
            processedArgs = middleware.apply(null, [classContext, ...processedArgs]);
            if (!Array.isArray(processedArgs)) {
              console.warn(`Constructor '${classContext.name.toString()}' beforeArgs middleware did not return array. Reverting.`);
              processedArgs = args;
            }
          });
        } catch (e) {
          console.error(`Error during constructor '${classContext.name.toString()}' 'beforeArgs' middleware:`, e);
          throw new Error(`Failed during constructor '${classContext.name.toString()}' 'beforeArgs' middleware`);
        }

        // Call super() - invokes the OriginalConstructor logic
        super(...processedArgs);

        // Process afterInstance (AFTER super call) - 'this' is now available
        try {
          let instance: any = this;
          afterInstance.forEach(middleware => {
            // Use call for ConstructorInstanceMiddleware (this is the instance)
            const potentiallyModifiedInstance = middleware.call(this, classContext, instance);
            // Allow middleware to replace the instance if it returns a value
            instance = potentiallyModifiedInstance !== undefined ? potentiallyModifiedInstance : instance;
          });
          // Note: If middleware replaced the instance, the original 'this' is discarded.
          // This is advanced usage and generally not recommended unless necessary.
        } catch (e) {
          console.error(`Error during constructor '${classContext.name.toString()}' 'afterInstance' middleware:`, e);
          throw new Error(`Failed during constructor '${classContext.name.toString()}' 'afterInstance' middleware`);
        }
      }
    };

    // --- Preserve Static Members & Prototype Chain ---
    function copyStatics(source: any, target: any) {
      let currentSource = source;
      const copiedKeys = new Set<string | symbol>();
      while (currentSource && currentSource !== Function.prototype) {
        Reflect.ownKeys(currentSource).forEach(key => {
          if (key !== 'prototype' && key !== 'length' && key !== 'name' &&
            key !== 'arguments' && key !== 'caller' && !copiedKeys.has(key)) {
            const descriptor = Object.getOwnPropertyDescriptor(currentSource, key);
            if (descriptor && (descriptor.configurable || descriptor.writable)) {
              Object.defineProperty(target, key, descriptor);
              copiedKeys.add(key);
            }
          }
        });
        currentSource = Object.getPrototypeOf(currentSource);
      }
    }

    copyStatics(OriginalConstructor, NewConstructor);
    Object.setPrototypeOf(NewConstructor.prototype, OriginalConstructor.prototype);
    Object.setPrototypeOf(NewConstructor, OriginalConstructor);

    return NewConstructor as unknown as TFunction;
  };
}
