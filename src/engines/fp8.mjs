// Finite E4M3, nearest-even and finite saturation, as defined in NVIDIA CUTLASS:
// https://github.com/NVIDIA/cutlass/blob/main/include/cutlass/float8.h
// Teaching implementation uses JS numbers, not GPU conversion or FP32 arithmetic.
export function decodeE4M3(code) {
  const magnitude = code & 127, exponent = magnitude >> 3, fraction = magnitude & 7;
  if (magnitude === 127) return NaN;
  const value = exponent === 0 ? fraction * 2 ** -9 : (1 + fraction / 8) * 2 ** (exponent - 7);
  return code & 128 ? -value : value;
}
const finite = Array.from({ length: 127 }, (_, code) => ({ code, value: decodeE4M3(code) }));
export function encodeE4M3(value) {
  if (Number.isNaN(value)) return 127;
  const sign = value < 0 || Object.is(value, -0) ? 128 : 0, magnitude = Math.abs(value);
  let best = finite[0], distance = Infinity;
  if (!Number.isFinite(magnitude)) return sign | 126;
  for (const candidate of finite) {
    const difference = Math.abs(candidate.value - magnitude);
    if (difference < distance || (difference === distance && !(candidate.code & 1))) {
      best = candidate;
      distance = difference;
    }
  }
  return sign | best.code;
}
export const tensorScale = (values) => Math.max(...values.map(Math.abs), 1e-12) / 448;
export function quantizeE4M3(value, scale) {
  if (!(scale > 0) || !Number.isFinite(scale)) throw Error('scale 必须为有限正数');
  const code = encodeE4M3(value / scale), decoded = decodeE4M3(code), restored = decoded * scale;
  // Dividing amax by its computed scale may exceed 448 by one JS rounding ULP.
  const clipped = Math.abs(value / scale) > 448 * (1 + 2 * Number.EPSILON);
  return { raw: value, code, decoded, restored, error: restored - value, clipped };
}
