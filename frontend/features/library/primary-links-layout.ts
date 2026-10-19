export interface PrimaryLinkPosition { x: number; y: number }

/** Steam aligns later rows to the columns established by its first row. Keep
 * all inputs in logical pixels, including the 1200px tall-window boundary. */
export function primaryLinkPositions(widths: number[], available: number, gap: number, rowHeight: number, maxRows: number): PrimaryLinkPosition[] {
	const positions: PrimaryLinkPosition[] = [];
	let x = 0, row = 0, column = 0;
	for (let index = 0; index < widths.length; index++) {
		const width = widths[index];
		if (width > available) {
			while (positions.length < widths.length) positions.push({ x: -1, y: -1 });
			break;
		}
		if (x + width > available) { x = 0; row++; column = 0; }
		positions.push(row < maxRows ? { x, y: row * rowHeight } : { x: -1, y: -1 });
		if (index === widths.length - 1) continue;
		if (row === 0) x += width + gap;
		else {
			while (positions[++column]?.y === 0 && positions[column].x < x + width) {}
			if (positions[column]?.y !== 0) { x = 0; row++; column = 0; }
			else x = positions[column].x;
		}
	}
	return positions;
}
