/**
 * Application entry point
 */
export function hello(name = 'world'): string {
  return `Hello, ${name}!`;
}

if (process.env.NODE_ENV !== 'test') {
  console.log(hello());
}
