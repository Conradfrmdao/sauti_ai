export const DEFAULT_COUNTRY_CALLING_CODE = "+256";

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;
const PHONE_INPUT_PATTERN = /^\+?[\d\s().-]+$/;

/**
 * Returns true when a value has the shape required by E.164: a leading plus,
 * a non-zero first digit, and no more than 15 digits in total.
 */
export function isE164PhoneNumber(value: string): boolean {
  return E164_PATTERN.test(value);
}

function callingCodeDigits(countryCallingCode: string): string | null {
  const trimmed = countryCallingCode.trim();
  const digits = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;

  return /^[1-9]\d{0,2}$/.test(digits) ? digits : null;
}

/**
 * Normalizes common human-entered phone formats to E.164. Numbers without an
 * international prefix are interpreted using Uganda's +256 calling code by
 * default. Invalid or ambiguous non-phone input returns null.
 */
export function normalizeE164PhoneNumber(
  input: string,
  defaultCountryCallingCode = DEFAULT_COUNTRY_CALLING_CODE
): string | null {
  const countryCode = callingCodeDigits(defaultCountryCallingCode);
  const trimmed = input.trim();

  if (!countryCode || !trimmed || !PHONE_INPUT_PATTERN.test(trimmed)) {
    return null;
  }

  const compact = trimmed.replace(/[\s().-]/g, "");
  let digits: string;

  if (compact.startsWith("+")) {
    const internationalDigits = compact.slice(1);
    digits = internationalDigits.startsWith(countryCode + "0")
      ? countryCode + internationalDigits.slice(countryCode.length + 1)
      : internationalDigits;
  } else if (compact.startsWith("00")) {
    const internationalDigits = compact.slice(2);
    digits = internationalDigits.startsWith(countryCode + "0")
      ? countryCode + internationalDigits.slice(countryCode.length + 1)
      : internationalDigits;
  } else if (compact.startsWith(countryCode)) {
    // Providers often omit the leading plus from an otherwise international
    // number. Also tolerate the common, but non-standard, +256(0)... spelling.
    digits = compact.slice(countryCode.length).startsWith("0")
      ? countryCode + compact.slice(countryCode.length + 1)
      : compact;
  } else {
    const nationalNumber = compact.startsWith("0") ? compact.slice(1) : compact;
    digits = countryCode + nationalNumber;
  }

  const normalized = `+${digits}`;
  return isE164PhoneNumber(normalized) ? normalized : null;
}
