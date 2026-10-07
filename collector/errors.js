// An error whose message is meant for the person at the terminal; the CLI
// prints it without a stack trace.
export class UserError extends Error {}
