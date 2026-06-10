export function classifyCoverageValue(value: number): string {
	if (value > 10) return "large";
	if (value === 0) return "zero";
	return "small";
}
