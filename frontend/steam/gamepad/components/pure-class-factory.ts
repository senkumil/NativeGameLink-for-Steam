/** Accept only Webpack's single-argument CSS export assignment containing
 * literal string keys/values. Calls, computed properties and statements fail. */
export function readPureClassFactory(factory: Function): Readonly<Record<string, string>> | null {
	const source = Function.prototype.toString.call(factory).trim();
	if (source.length > 262144) return null;
	const arrow = /^(?:\(\s*([$A-Z_a-z][$\w]*)\s*\)|([$A-Z_a-z][$\w]*))\s*=>\s*\{([\s\S]*)\}$/.exec(source);
	const regular = arrow ? null : /^function(?:\s+[$A-Z_a-z][$\w]*)?\s*\(\s*([$A-Z_a-z][$\w]*)\s*\)\s*\{([\s\S]*)\}$/.exec(source);
	const parameter = arrow ? arrow[1] || arrow[2] : regular?.[1];
	const body = arrow ? arrow[3] : regular?.[2];
	if (!parameter || !body) return null;
	const escaped = parameter.replace(/[$]/g, '\\$');
	const assignment = new RegExp(`^\\s*${escaped}\\.exports\\s*=\\s*\\{([\\s\\S]*)\\}\\s*;?\\s*$`).exec(body);
	if (!assignment) return null;
	const literal = assignment[1], values: Record<string, string> = Object.create(null);
	const property = /\s*(?:([$A-Z_a-z][$\w]*)|("(?:[^"\\]|\\.)*"))\s*:\s*("(?:[^"\\]|\\.)*")\s*(,|$)/y;
	let cursor = 0;
	try {
		while (literal.slice(cursor).trim()) {
			property.lastIndex = cursor;
			const match = property.exec(literal);
			if (!match) return null;
			const key = match[1] || JSON.parse(match[2]), value = JSON.parse(match[3]);
			if (!value || Object.prototype.hasOwnProperty.call(values, key)) return null;
			values[key] = value; cursor = property.lastIndex;
		}
	} catch { return null; }
	return Object.keys(values).length ? values : null;
}
