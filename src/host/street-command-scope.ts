import { useScene } from "@pascal-app/core";
const key = Symbol.for("pascal:streetscape:accepted-command-scope");
const runtime = useScene as unknown as Record<symbol, {depth: number}>;
const scope = runtime[key] ?? (runtime[key] = {depth: 0});

export function isAcceptedStreetCommand() {
	return scope.depth > 0;
}

/** Host adapters must not reinterpret the already reconciled command batch. */
export function withAcceptedStreetCommand<T>(commit: () => T): T {
	scope.depth++;
	try {
		return commit();
	} finally {
		scope.depth--;
	}
}
