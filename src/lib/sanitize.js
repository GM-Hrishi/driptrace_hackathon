/**
 * Input sanitizing for anything that reaches Firebase from a form.
 *
 * Client writes are denied by the security rules, so this is the second of two
 * layers rather than the only one - but every admin/setup field passes through
 * here before it is sent, so a malformed bed label can never be persisted and
 * then re-rendered on the ward view.
 */

/** Firebase keys cannot contain . $ # [ ] / or control characters. */
const ILLEGAL_KEY_CHARS = /[.$#[\]/\u0000-\u001f\u007f]/g

/** Control characters and bidi overrides, which can disguise rendered text. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\u202a-\u202e]/g

/** Stripped from free text: React escapes on render, but a stored value also
    reaches places that do not, such as document.title and SVG attributes. */
const ANGLE_BRACKETS = /[<>]/g

/**
 * Plain single-line text for a label, ward name or note.
 * @param {unknown} value
 * @param {number} [maxLength]
 */
export function sanitizeText(value, maxLength = 80) {
  if (typeof value !== 'string') return ''
  return value
    .replace(UNSAFE_TEXT, '')
    .replace(ANGLE_BRACKETS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/**
 * A safe Realtime Database key, e.g. a bed id typed on the setup screen.
 * @param {unknown} value
 */
export function sanitizeKey(value) {
  if (typeof value !== 'string') return ''
  return value
    // Replaced, not deleted: dropping the slash in "Ward A/Bed 01" would weld
    // two separate words into one unreadable key.
    .replace(ILLEGAL_KEY_CHARS, '-')
    .replace(UNSAFE_TEXT, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48)
}

/**
 * A finite number inside an explicit range, or null when the input is not a
 * usable number. Never silently coerces NaN to 0.
 *
 * @param {unknown} value
 * @param {{ min: number, max: number }} bounds
 * @returns {number | null}
 */
export function sanitizeNumber(value, { min, max }) {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(n)) return null
  if (n < min || n > max) return null
  return n
}
