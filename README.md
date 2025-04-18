# ts-observe: Function/Method/Class Observation and Middleware

```ts-observe``` provides a flexible way to wrap functions, methods, accessors, and class constructors with middleware logic in TypeScript. This allows you to execute code *before* and *after* the original logic runs, enabling Aspect-Oriented Programming (AOP) patterns like logging, validation, caching, performance monitoring, and more, primarily through the use of decorators.

## Development

From your terminal run:

```sh
npm i ts-observe
```

to install the package.

If you are using typescript, make sure to include the following in your tsconfig.json:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

## Core Concept: The ```observe``` Function

At its heart, ```ts-observe``` uses the ```observe``` function to wrap a target function.

```typescript
import { observe, MiddlewareContext } from 'ts-observe';

// Example Middleware
const logBefore: (context: MiddlewareContext, ...args: any[]) => any[] = (context, ...args) => {
  console.log(`[${context.kind}:${String(context.name)}] Calling with args:`, args);
  return args; // Must return the (potentially modified) arguments array
};

const logAfter: (context: MiddlewareContext, result: any) => any = (context, result) => {
  console.log(`[${context.kind}:${String(context.name)}] Returned:`, result);
  return result; // Must return the (potentially modified) result
};

// Original function
function add(a: number, b: number): number {
  console.log('Executing add...');
  return a + b;
}

// Wrap the function
const observedAdd = observe(add, [logBefore], [logAfter]);

// Call the wrapped function
const sum = observedAdd(5, 3);
// Output:
// [function:add] Calling with args: [ 5, 3 ]
// Executing add...
// [function:add] Returned: 8

console.log('Final Sum:', sum); // Output: Final Sum: 8
```

While ```observe``` can be used directly, the primary way to use ```ts-observe``` is through decorators for classes, methods, and accessors.

# Decorators
## ```ObserveMethod```
Use ```@ObserveMethod``` to apply middleware to class methods.

```typescript
import { ObserveMethod, MethodArgsMiddleware, MethodResultMiddleware, MiddlewareContext } from 'ts-observe';

// Middleware specific to methods
const validatePositiveArgs: MethodArgsMiddleware<number[]> = function(this: any, context, ...args) {
  console.log(`[${context.kind}:${String(context.name)}] Validating args on instance:`, this);
  if (args.some(arg => arg <= 0)) {
    throw new Error("Arguments must be positive!");
  }
  return args; // Return original or modified args
};

const doubleResult: MethodResultMiddleware<number> = function(this: any, context, result) {
  console.log(`[${context.kind}:${String(context.name)}] Doubling result on instance:`, this);
  return result * 2;
};

class Calculator {
  id = Math.random();

  @ObserveMethod({
    beforeArgs: [validatePositiveArgs],
    afterResult: [doubleResult]
  })
  multiply(a: number, b: number): number {
    console.log('Executing multiply...');
    return a * b;
  }
}

const calc = new Calculator();
const product = calc.multiply(4, 5);
// Output:
// [method:multiply] Validating args on instance: Calculator { id: 0.123... }
// Executing multiply...
// [method:multiply] Doubling result on instance: Calculator { id: 0.123... }

console.log('Final Product:', product); // Output: Final Product: 40

try {
  calc.multiply(4, -5);
} catch (e: any) {
  console.error(e.message); // Output: Arguments must be positive!
}
```
## ```ObserveAccessor```
Use ```@ObserveAccessor``` to apply middleware to class property getters and setters.

```typescript
import { ObserveAccessor, AccessorGetResultMiddleware, AccessorSetArgMiddleware, AccessorSetResultMiddleware, MiddlewareContext } from 'ts-observe';

// Middleware specific to accessors
const logGet: AccessorGetResultMiddleware<string> = function(this: any, context, result) {
  console.log(`[${context.kind}:${String(context.name)}] Got value: '${result}' on instance:`, this);
  return result.toUpperCase(); // Modify the result
};

const validateSet: AccessorSetArgMiddleware<string> = function(this: any, context, value) {
  console.log(`[${context.kind}:${String(context.name)}] Validating set value: '${value}' on instance:`, this);
  if (value.length < 3) {
    throw new Error("Name must be at least 3 characters long.");
  }
  return value; // Return original or modified value
};

const logSetComplete: AccessorSetResultMiddleware = function(this: any, context, result) {
    // Note: Setters return void, so 'result' is undefined here.
    console.log(`[${context.kind}:${String(context.name)}] Set operation complete on instance:`, this);
    // Setters don't return a value, so we don't return anything either.
};


class User {
  private _name: string = 'Default';
  id = Math.random();

  @ObserveAccessor({
    afterGet: [logGet],
    beforeSet: [validateSet],
    afterSet: [logSetComplete]
  })
  get name(): string {
    console.log('Executing getter...');
    return this._name;
  }

  set name(newName: string) {
    console.log('Executing setter...');
    this._name = newName;
  }
}

const user = new User();

// Using the setter
try {
    user.name = 'Alice';
    // Output:
    // [setter:name] Validating set value: 'Alice' on instance: User { _name: 'Default', id: 0.456... }
    // Executing setter...
    // [setter:name] Set operation complete on instance: User { _name: 'Alice', id: 0.456... }

    user.name = 'Bo';
} catch (e: any) {
    console.error(e.message); // Output: Name must be at least 3 characters long.
}


// Using the getter
const currentName = user.name;
// Output:
// Executing getter...
// [getter:name] Got value: 'Alice' on instance: User { _name: 'Alice', id: 0.456... }

console.log('Current Name:', currentName); // Output: Current Name: ALICE
```

## ```ObserveClass```
Use ```@ObserveClass``` to apply middleware to the class constructor.
- ```beforeArgs```: Runs before the ```super()``` call within the constructor wrapper. Useful for validating or transforming constructor arguments. ```this``` is not available yet.
- ```afterInstance```: Runs after the ```super()``` call. ```this``` refers to the newly created instance. Useful for logging instance creation or performing post-initialization logic.

```typescript
import { ObserveClass, ConstructorArgsMiddleware, ConstructorInstanceMiddleware, MiddlewareContext } from './observe';

// Middleware specific to constructors
const logConstructorArgs: ConstructorArgsMiddleware<any[]> = (context, ...args) => {
  console.log(`[${context.kind}:${context.name}] Constructing with args:`, args);
  // Modify args if needed: return [args[0].toUpperCase(), ...args.slice(1)];
  return args;
};

const logInstanceCreation: ConstructorInstanceMiddleware<any> = function(this: any, context, instance) {
  console.log(`[${context.kind}:${context.name}] Instance created:`, instance);
  // Can modify the instance here, or even return a different object (advanced)
  // this.initialized = true;
  return instance; // Return the instance (or a modified/replaced one)
};

@ObserveClass({
  beforeArgs: [logConstructorArgs],
  afterInstance: [logInstanceCreation]
})
class Greeter {
  greeting: string;
  name: string;

  constructor(message: string, name: string) {
    console.log('Executing original constructor...');
    this.greeting = message;
    this.name = name;
  }

  greet() {
    return `${this.greeting}, ${this.name}!`;
  }

  static staticMethod() {
    console.log("Static method called!");
  }
}

// Call the constructor
const greeter = new Greeter('Hello', 'World');
// Output:
// [class:Greeter] Constructing with args: [ 'Hello', 'World' ]
// Executing original constructor...
// [class:Greeter] Instance created: Greeter { greeting: 'Hello', name: 'World' }

console.log(greeter.greet()); // Output: Hello, World!

// Static members are preserved
Greeter.staticMethod(); // Output: Static method called!
```

# Middleware Context
All middleware functions receive a MiddlewareContext object as their first argument (after this where applicable). This object provides information about the element being observed:

- ```kind```: ```'function'```, ```'method'```, ```'getter'```, ```'setter'```, or ```'class'```.
- ```name```: The name of the function, method, property, or class.
- ```target```: The object the member belongs to (prototype for instance members, constructor for static members/class).

# Middleware Types
```ts-observe``` provides specific types for middleware functions to ensure type safety:

- ```MethodArgsMiddleware<TArgs>```: For ```beforeArgs``` in ```@ObserveMethod```. Receives ```this```, ```context```, and method arguments (```...args```). Must return an array of arguments.
- ```MethodResultMiddleware<TReturn>```: For ```afterResult``` in ```@ObserveMethod```. Receives ```this```, ```context```, and the method result. Must return a result of the same type.
- ```AccessorGetResultMiddleware<TReturn>```: For ```afterGet``` in ```@ObserveAccessor```. Receives ```this```, ```context```, and the getter result. Must return a result of the same type.
- ```AccessorSetArgMiddleware<TVal>```: For ```beforeSet``` in ```@ObserveAccessor```. Receives ```this```, ```context```, and the value being set. Must return a value of the same type.
- ```AccessorSetResultMiddleware```: For ```afterSet``` in ```@ObserveAccessor```. Receives ```this```, ```context```, and ```undefined``` (as setters return ```void```). Should not return a value.
- ```ConstructorArgsMiddleware<TArgs>```: For ```beforeArgs``` in ```@ObserveClass```. Receives ```null``` (for ```this```), ```context```, and constructor arguments (```...args```). Must return an array of arguments.
- ```ConstructorInstanceMiddleware<TInstance>```: For ```afterInstance``` in ```@ObserveClass```. Receives the new ```instance``` (for ```this```), ```context```, and the ```instance``` again. Can optionally return a modified or replacement ```instance```.

# Error Handling
Errors occurring within middleware functions are caught and logged to the console.

- Errors in ```before``` middleware prevent the original function/method/constructor from executing and re-throw a new error.
- Errors in the original function execution are caught, logged, and re-thrown, preserving the original stack trace.
- Errors in ```after``` middleware are caught, logged, and re-throw a new error after the original function has already executed.

Middleware functions that are supposed to return arguments (like ```beforeArgs```) but return a non-array value will cause a warning, and the original arguments will be used instead to prevent unexpected behavior.