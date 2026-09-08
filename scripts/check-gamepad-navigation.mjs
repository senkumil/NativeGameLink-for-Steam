import assert from 'node:assert/strict';

// Test simulation of spatial navigation candidate tier selection and scoring logic
function simulateNavStep(currentRect, focusableRects, direction) {
	if (direction === 'down') {
		const candidates = focusableRects.filter(r => {
			if (r === currentRect) return false;
			return r.top >= currentRect.bottom - 4 || (r.top >= currentRect.top + 10 && r.bottom > currentRect.bottom + 6);
		});
		if (!candidates.length) return null;

		let minVert = Infinity;
		for (const r of candidates) {
			const v = Math.max(0, r.top - currentRect.bottom);
			if (v < minVert) minVert = v;
		}

		// Strict immediate-row window (10px)
		const tier = candidates.filter(r => {
			const v = Math.max(0, r.top - currentRect.bottom);
			return v <= minVert + 10;
		});

		let target = null;
		let bestScore = Infinity;
		const currentCenterX = currentRect.left + currentRect.width / 2;
		for (const r of tier) {
			const v = Math.max(0, r.top - currentRect.bottom);
			const targetCenterX = r.left + r.width / 2;
			const overlap = Math.max(0, Math.min(currentRect.right, r.right) - Math.max(currentRect.left, r.left));
			const horiz = Math.abs(targetCenterX - currentCenterX) - (overlap > 0 ? overlap : -50);
			const score = v * 20 + horiz;
			if (score < bestScore) {
				bestScore = score;
				target = r;
			}
		}
		return target;
	}

	if (direction === 'up') {
		const candidates = focusableRects.filter(r => {
			if (r === currentRect) return false;
			return r.bottom <= currentRect.top + 4 || (r.bottom <= currentRect.bottom - 10 && r.top < currentRect.top - 6);
		});
		if (!candidates.length) return null;

		let minVert = Infinity;
		for (const r of candidates) {
			const v = Math.max(0, currentRect.top - r.bottom);
			if (v < minVert) minVert = v;
		}

		const tier = candidates.filter(r => {
			const v = Math.max(0, currentRect.top - r.bottom);
			return v <= minVert + 10;
		});

		let target = null;
		let bestScore = Infinity;
		const currentCenterX = currentRect.left + currentRect.width / 2;
		for (const r of tier) {
			const v = Math.max(0, currentRect.top - r.bottom);
			const targetCenterX = r.left + r.width / 2;
			const overlap = Math.max(0, Math.min(currentRect.right, r.right) - Math.max(currentRect.left, r.left));
			const horiz = Math.abs(targetCenterX - currentCenterX) - (overlap > 0 ? overlap : -50);
			const score = v * 20 + horiz;
			if (score < bestScore) {
				bestScore = score;
				target = r;
			}
		}
		return target;
	}
	return null;
}

console.log('Running Big Picture Gamepad Spatial Navigation Unit Tests...');

// Case 1: Vertical list with varying item widths (e.g. Button followed by Full-Width Card followed by Link)
// In the old algorithm (+45px and -500 overlap bonus), the Button was skipped in favor of the Full-Width Card.
const itemA = { id: 'A', top: 100, bottom: 140, left: 20, right: 320, width: 300, height: 40 }; // Post bar
const itemB = { id: 'B', top: 152, bottom: 184, left: 20, right: 120, width: 100, height: 32 }; // Narrow button
const itemC = { id: 'C', top: 196, bottom: 356, left: 20, right: 320, width: 300, height: 160 }; // Full-width event card
const itemD = { id: 'D', top: 368, bottom: 400, left: 20, right: 180, width: 160, height: 32 }; // Friend item
const items = [itemA, itemB, itemC, itemD];

// Moving down from A must hit B (NOT skip to C!)
let next = simulateNavStep(itemA, items, 'down');
assert.equal(next?.id, 'B', 'Step 1: Navigating down from A must hit B');
console.log('  [PASS] Navigating down from A lands on B without skipping');

// Moving down from B must hit C
next = simulateNavStep(itemB, items, 'down');
assert.equal(next?.id, 'C', 'Step 2: Navigating down from B must hit C');
console.log('  [PASS] Navigating down from B lands on C without skipping');

// Moving down from C must hit D
next = simulateNavStep(itemC, items, 'down');
assert.equal(next?.id, 'D', 'Step 3: Navigating down from C must hit D');
console.log('  [PASS] Navigating down from C lands on D without skipping');

// Moving up from D must hit C
let prev = simulateNavStep(itemD, items, 'up');
assert.equal(prev?.id, 'C', 'Step 4: Navigating up from D must hit C');
console.log('  [PASS] Navigating up from D lands on C without skipping');

// Moving up from C must hit B
prev = simulateNavStep(itemC, items, 'up');
assert.equal(prev?.id, 'B', 'Step 5: Navigating up from C must hit B');
console.log('  [PASS] Navigating up from C lands on B without skipping');

// Moving up from B must hit A
prev = simulateNavStep(itemB, items, 'up');
assert.equal(prev?.id, 'A', 'Step 6: Navigating up from B must hit A');
console.log('  [PASS] Navigating up from B lands on A without skipping');

// Case 2: 2D Grid navigation (e.g. Community Cards or Achievements)
// Row 1: G0, G1, G2
// Row 2: G3, G4, G5
const g0 = { id: 'G0', top: 100, bottom: 260, left: 20, right: 280, width: 260, height: 160 };
const g1 = { id: 'G1', top: 100, bottom: 260, left: 300, right: 560, width: 260, height: 160 };
const g2 = { id: 'G2', top: 100, bottom: 260, left: 580, right: 840, width: 260, height: 160 };
const g3 = { id: 'G3', top: 280, bottom: 440, left: 20, right: 280, width: 260, height: 160 };
const g4 = { id: 'G4', top: 280, bottom: 440, left: 300, right: 560, width: 260, height: 160 };
const g5 = { id: 'G5', top: 280, bottom: 440, left: 580, right: 840, width: 260, height: 160 };
const grid = [g0, g1, g2, g3, g4, g5];

assert.equal(simulateNavStep(g0, grid, 'down')?.id, 'G3', 'Grid: G0 down -> G3');
assert.equal(simulateNavStep(g1, grid, 'down')?.id, 'G4', 'Grid: G1 down -> G4');
assert.equal(simulateNavStep(g2, grid, 'down')?.id, 'G5', 'Grid: G2 down -> G5');
assert.equal(simulateNavStep(g3, grid, 'up')?.id, 'G0', 'Grid: G3 up -> G0');
assert.equal(simulateNavStep(g4, grid, 'up')?.id, 'G1', 'Grid: G4 up -> G1');
assert.equal(simulateNavStep(g5, grid, 'up')?.id, 'G2', 'Grid: G5 up -> G2');
console.log('  [PASS] 2D Grid navigation maintains column continuity and never skips rows');

console.log('All spatial navigation tests passed successfully!');
