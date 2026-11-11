# The strict lint

[Türkçe](lint.tr.md)

How the code meets typescript-eslint's type-checked rules where a rule leaves a choice. [CONTRIBUTING](../../CONTRIBUTING.md)
says how the lint runs, and when a rule may be turned off for a line.

- A `!` gives way to what the compiler can follow: a destructuring or a loop over entries in place of an index, one
  `get` and a check in place of `has` then `get!`, a value an `if` narrowed held in a `const`. Where the code knows what
  the types cannot (an index within bounds, a key it set, a regex's group), core's `must(value, 'what')` throws naming
  what is missing, where a `!` went on with undefined; `protocol`, which imports nothing, checks with an `if`. Never
  `as` in its place. In a test, vitest's `assert(x)` narrows, and `?.` will do inside an `expect` whose matcher fails on
  undefined.
- An `async` function with no `await` is a plain one where no caller needs a promise of it, and its callers lose their
  `await`. Where its type or a caller needs one (a port, a fake of one, a `.catch` on it), it returns
  `Promise.resolve(x)`, and `Promise.reject(e)` in place of a `throw`, which a `.catch` would miss; a body that may
  throw on its own goes in `new Promise((resolve) => { resolve(work()); })`.
- What comes from outside (JSON, the wire, a device, a file, the environment, argv, a tool's output) is `unknown`, or a
  type that says what may be missing, until a schema or a check narrows it, so that a check on it is one the types need
  too: `no-unnecessary-condition` never takes one away. JSON whose shape the code wrote itself is cast at the call,
  never by a generic that hides it. A `catch` callback takes `(e: unknown)`, and reads it by
  `e instanceof Error ? e.message : String(e)`.
- A flag a callback sets, which the compiler takes for the value it starts with, is `let done = false as boolean`, as
  typescript-eslint advises for that, with a word on why.
- `||` stays for strings and booleans, where `''` and `false` fall through as meant; a number or an object takes `??`,
  unless `0` should fall through too, which the line then says.
- What is handed around unbound (`stop`, a fake's members) is an arrow or bound. A mock is read in a test as the mock it
  is, never off its port's type.
- A template holds strings and numbers: an undefined goes by narrowing where it cannot be, and `String(x)` keeps the
  text where it is meant. vitest's asymmetric matchers are typed `any`: one inside an object is `as unknown`.
- `void` in a union is `undefined`, and a function that answers nothing says `Promise<undefined>`, as TypeScript takes
  no `return` for `void`.
